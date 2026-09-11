// 가짜 시청자 N명을 WHEP으로 붙여서, 각자 영상을 제대로 받고 있는지 센다.
//
// 브라우저 대신 쓰는 이유: 크롬 한 개가 수백 MB라 수백 명을 흉내 낼 수 없다.
// 여기서는 디코딩을 하지 않고 RTP 패킷만 받는다 — 서버 입장에서는 실제 시청자와
// 똑같이 보내야 하므로, 서버의 한계를 재는 데는 충분하다.
//
// 판정 기준(미리 정한 것, 결과를 보고 바꾸지 않는다):
//   창(window) 하나 동안 받은 비트레이트가 기준의 90% 이상이고 패킷 손실이 2% 이하면 OK.
//   기준(-baseline-kbps)은 시청자 1명일 때 잰 값을 넣는다.
//
// 출력: 창마다 한 줄 CSV (stdout), 끝나면 요약 (stderr).
package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v4"
)

var dumpAnswer, ipv6Only bool

type viewer struct {
	id        int
	bytes     atomic.Uint64
	received  atomic.Uint64 // 받은 RTP 패킷 수
	expected  atomic.Uint64 // 시퀀스 번호로 계산한, 받았어야 할 패킷 수
	connected atomic.Bool
	failed    atomic.Bool

	// 창마다 차이를 내기 위한 직전 값 (리포터만 만진다)
	lastBytes, lastReceived, lastExpected uint64
}

func main() {
	url := flag.String("url", "", "WHEP 엔드포인트 (예: https://whep.example.org/<streamId>/whep)")
	n := flag.Int("n", 10, "시청자 수")
	ramp := flag.Duration("ramp", 200*time.Millisecond, "시청자 사이 접속 간격")
	duration := flag.Duration("duration", 5*time.Minute, "전원 접속 후 유지 시간")
	window := flag.Duration("window", 5*time.Second, "판정 창 길이")
	baseline := flag.Float64("baseline-kbps", 0, "정상 비트레이트(kbps). 0이면 판정 없이 측정만")
	flag.BoolVar(&ipv6Only, "ipv6-only", false, "IPv6 후보로만 연결한다 (모바일 통신사 경로 재현용)")
	flag.BoolVar(&dumpAnswer, "dump-answer", false, "서버가 준 SDP 응답의 candidate 줄을 stderr로 (ICE 후보 확인용)")
	flag.Parse()
	if *url == "" {
		fmt.Fprintln(os.Stderr, "-url이 필요하다")
		os.Exit(2)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	// 접속시키는 쪽과 리포터가 동시에 읽고 쓰므로 원자적 포인터로 둔다
	viewers := make([]atomic.Pointer[viewer], *n)
	var wg sync.WaitGroup
	start := time.Now()

	go report(ctx, viewers, start, *window, *baseline)

	for i := range viewers {
		v := &viewer{id: i}
		viewers[i].Store(v)
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := v.run(ctx, *url); err != nil && ctx.Err() == nil {
				v.failed.Store(true)
				fmt.Fprintf(os.Stderr, "viewer %d: %v\n", v.id, err)
			}
		}()
		select {
		case <-ctx.Done():
		case <-time.After(*ramp):
		}
	}

	select {
	case <-ctx.Done():
	case <-time.After(*duration):
	}
	cancel()
	wg.Wait()
	summary(viewers, time.Since(start))
}

func (v *viewer) run(ctx context.Context, url string) error {
	// 기본 코덱·인터셉터(NACK·RTCP 리포트)를 쓴다. 브라우저처럼 재전송을 요청해야
	// 서버가 실제 시청자에게 하는 일(재전송 포함)을 똑같이 한다.
	se := webrtc.SettingEngine{}
	if ipv6Only {
		se.SetNetworkTypes([]webrtc.NetworkType{webrtc.NetworkTypeUDP6})
	}
	// NewPeerConnection 기본값과 같은 코덱·인터셉터(NACK 등)를 명시적으로 넣는다.
	// 설정 엔진만 넘기면 이 둘이 빠져서 브라우저와 다르게 동작한다.
	me := &webrtc.MediaEngine{}
	if err := me.RegisterDefaultCodecs(); err != nil {
		return err
	}
	ir := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(me, ir); err != nil {
		return err
	}
	api := webrtc.NewAPI(webrtc.WithMediaEngine(me), webrtc.WithInterceptorRegistry(ir), webrtc.WithSettingEngine(se))
	pc, err := api.NewPeerConnection(webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}},
	})
	if err != nil {
		return err
	}
	defer pc.Close()

	for _, kind := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeVideo, webrtc.RTPCodecTypeAudio} {
		if _, err := pc.AddTransceiverFromKind(kind, webrtc.RTPTransceiverInit{
			Direction: webrtc.RTPTransceiverDirectionRecvonly,
		}); err != nil {
			return err
		}
	}

	pc.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		v.connected.Store(true)
		var highest uint32 // 32비트로 펼친 시퀀스 번호
		var cycles uint32
		var last uint16
		started := false
		for {
			pkt, _, err := track.ReadRTP()
			if err != nil {
				return
			}
			v.bytes.Add(uint64(len(pkt.Payload) + 12))
			v.received.Add(1)

			seq := pkt.SequenceNumber
			if !started {
				highest, last, started = uint32(seq), seq, true
				v.expected.Add(1)
				continue
			}
			if seq < last && last-seq > 0x8000 { // 65535 → 0 으로 넘어감
				cycles += 1 << 16
			}
			last = seq
			ext := cycles | uint32(seq)
			if ext > highest {
				v.expected.Add(uint64(ext - highest))
				highest = ext
			}
		}
	})

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		return err
	}
	gathered := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(offer); err != nil {
		return err
	}
	select {
	case <-gathered:
	case <-ctx.Done():
		return nil
	}

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url,
		bytes.NewBufferString(pc.LocalDescription().SDP))
	req.Header.Set("Content-Type", "application/sdp")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	answer, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("WHEP %d: %s", resp.StatusCode, bytes.TrimSpace(answer))
	}
	if dumpAnswer {
		for _, line := range bytes.Split(answer, []byte("\n")) {
			if bytes.HasPrefix(line, []byte("a=candidate")) {
				fmt.Fprintf(os.Stderr, "viewer %d: %s\n", v.id, bytes.TrimSpace(line))
			}
		}
	}
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer, SDP: string(answer),
	}); err != nil {
		return err
	}

	// 세션 종료를 서버에 알린다 — 안 하면 서버가 타임아웃까지 보낼 곳 없는 세션을 들고 있다
	if loc := resp.Header.Get("Location"); loc != "" {
		defer func() {
			del, _ := http.NewRequest(http.MethodDelete, resolve(url, loc), nil)
			if r, err := http.DefaultClient.Do(del); err == nil {
				r.Body.Close()
			}
		}()
	}

	<-ctx.Done()
	return nil
}

func resolve(base, loc string) string {
	if len(loc) > 0 && loc[0] == '/' {
		// base의 scheme://host 부분만 남긴다
		slashes := 0
		for i, c := range base {
			if c == '/' {
				slashes++
				if slashes == 3 {
					return base[:i] + loc
				}
			}
		}
	}
	return loc
}

func report(ctx context.Context, viewers []atomic.Pointer[viewer], start time.Time, window time.Duration, baseline float64) {
	fmt.Println("elapsed_s,joined,connected,failed,ok,ok_pct,kbps_p5,kbps_p50,loss_pct_p95,total_mbps")
	t := time.NewTicker(window)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		var kbps, loss []float64
		joined, connected, failed, ok := 0, 0, 0, 0
		var totalBits float64
		for i := range viewers {
			v := viewers[i].Load()
			if v == nil {
				continue
			}
			joined++
			if v.failed.Load() {
				failed++
			}
			b, r, e := v.bytes.Load(), v.received.Load(), v.expected.Load()
			db, dr, de := b-v.lastBytes, r-v.lastReceived, e-v.lastExpected
			v.lastBytes, v.lastReceived, v.lastExpected = b, r, e
			if !v.connected.Load() {
				continue
			}
			connected++
			rate := float64(db) * 8 / 1000 / window.Seconds()
			lp := 0.0
			if de > 0 && de > dr {
				lp = float64(de-dr) / float64(de) * 100
			}
			kbps = append(kbps, rate)
			loss = append(loss, lp)
			totalBits += float64(db) * 8
			if baseline > 0 && rate >= 0.9*baseline && lp <= 2 {
				ok++
			}
		}
		okPct := 0.0
		if connected > 0 {
			okPct = float64(ok) / float64(joined) * 100
		}
		fmt.Printf("%.0f,%d,%d,%d,%d,%.1f,%.0f,%.0f,%.2f,%.1f\n",
			time.Since(start).Seconds(), joined, connected, failed, ok, okPct,
			pct(kbps, 5), pct(kbps, 50), pct(loss, 95), totalBits/1e6/window.Seconds())
	}
}

func pct(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	return s[int(float64(len(s)-1)*p/100)]
}

func summary(viewers []atomic.Pointer[viewer], elapsed time.Duration) {
	connected, failed := 0, 0
	var total uint64
	for i := range viewers {
		v := viewers[i].Load()
		if v == nil {
			continue
		}
		if v.connected.Load() {
			connected++
		}
		if v.failed.Load() {
			failed++
		}
		total += v.bytes.Load()
	}
	fmt.Fprintf(os.Stderr, "\n요약: %d명 중 연결 %d, 실패 %d, 총 수신 %.1f MB, %.0f초\n",
		len(viewers), connected, failed, float64(total)/1e6, elapsed.Seconds())
}
