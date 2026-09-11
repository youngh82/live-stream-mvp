# Load tests

Two small tools, run from a machine **other than the server**. A load generator on the
same host measures its own contention, not the server's.

## `whep-viewers/` — synthetic WebRTC viewers

Go + [pion](https://github.com/pion/webrtc). Each viewer does a real WHEP handshake and
receives RTP with the default interceptors (NACK, RTCP reports), so the server does the
same work it does for a browser, but nothing is decoded. That keeps a single 2-vCPU
machine able to act as a few hundred viewers.

```bash
# build a static Linux binary without installing Go
docker run --rm -v "$PWD/loadtest/whep-viewers":/src -w /src \
  -e CGO_ENABLED=0 -e GOOS=linux -e GOARCH=amd64 golang:1.24 \
  go build -trimpath -ldflags="-s -w" -o whep-viewers .

./whep-viewers -url https://whep.<domain>/<streamId>/whep \
  -n 150 -ramp 100ms -duration 20m -baseline-kbps 2530
```

Every window (default 5 s) prints a CSV row: joined / connected / failed, the share of
viewers that are **OK**, and the p5/p50 bitrate, p95 loss, and total received Mbps.

A viewer is OK for a window if it received **≥ 90% of the baseline bitrate with ≤ 2%
packet loss**. The baseline is what a single viewer receives. These thresholds were set
before the first run and not adjusted afterwards.

Debug flags: `-dump-answer` prints the ICE candidates the server offered, and
`-ipv6-only` restricts ICE to UDP over IPv6, which approximates a mobile carrier path.

## `chat/chat-load.mjs` — chat fan-out latency

Opens N Socket.IO connections to one room. A few senders post one message per second
with the send time embedded, and every socket records how long delivery took. All sockets
share one clock because they run on one machine.

```bash
node loadtest/chat/chat-load.mjs --ws https://ws.<domain> --stream <id> \
  --tokens tokens.txt --n 500 --senders 5 --duration 60
```

`tokens.txt` holds one Supabase access token per line; sockets reuse them round-robin.
Server rate limit is 2 msg/s per user, so senders stay at 1/s.

It waits until every socket has joined or failed (`--join-timeout`, default 120 s) and only
times sockets that were connected when measurement started. The output includes `join_secs`;
joining, not delivery, is where the server spends its CPU.

The feed API was measured with [`autocannon`](https://github.com/mcollina/autocannon):
`npx autocannon -c 50 -d 30 https://<domain>/api/feed?limit=5`. Put a few streams live first —
an empty feed never reaches the database and looks much faster than it is.

## Results

See **Load test** in the top-level README.
