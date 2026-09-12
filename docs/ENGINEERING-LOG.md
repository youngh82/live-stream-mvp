# Engineering log

Problems this project actually hit, and what turned out to be causing them.

Only entries with a **confirmed** cause are here. Where a fix is easy to undo by
accident, the entry says what must not be reverted — several of these were found
twice because the second person didn't know why the first fix looked odd.

- [Media and streaming](#media-and-streaming)
- [Security](#security)
- [Feed and realtime](#feed-and-realtime)
- [Platform and tooling](#platform-and-tooling)
- [Operations and deployment](#operations-and-deployment)
- [Still open](#still-open)

---

## Media and streaming

### Low-latency HLS bottomed out at ~13 seconds

**Symptom.** Glass-to-glass latency stayed around 13s no matter how the HLS
settings were tuned — 500ms segments, 100ms parts, live-edge jumping, drift
correction. Chat and tipping felt broken because viewers were reacting to
something the streamer had finished ten seconds earlier.

**Cause.** Structural, not configuration. HLS delivers video as segments, so
segment creation plus client buffering sets a floor that tuning cannot go under.

**Fix.** Playback moved to **WebRTC over WHEP**. MediaMTX already speaks it, so
the change was `webrtc: yes` plus replacing the hls.js player with an
`RTCPeerConnection`. Latency came in **under one second**.

The HLS pipeline is still enabled and remuxing, because the thumbnail worker
reads frames from it — MediaMTX has no snapshot API, and turning on RTSP to get
one would have meant changing the media server's configuration surface.

---

### The phone camera returned landscape frames in a portrait app — four attempts to fix

This is a 9:16 product, but holding the phone upright still produced 1920×1080.

**The evidence that settled it.** `applyConstraints({ width: { exact: 1080 },
height: { exact: 1920 } })` returned **1920×1080 with no error**. 720×1280 came
back as 1280×720; 480×640 as 640×480. Every request was swapped and reported as
satisfied. This is not a rejection that can be worked around by combining
constraints — the platform answers "done" while giving the opposite.

**Two causes, both in our own code.**

1. **We were asking for portrait resolutions.** Mobile cameras do not support
   arbitrary aspect ratios. The correct approach is to request a **standard
   landscape resolution** (1280×720) and let the device decide orientation —
   held upright, it returns 720×1280 on its own. Asking for portrait actively
   breaks that auto-rotation.
2. **`getUserMedia` was called again without stopping the previous track.** iOS
   will not re-read device orientation while a capture session is alive; it
   hands back the swapped track. React StrictMode's double mount, or a
   double-tapped button, reproduces it reliably.

**Fix** (`useCamera.ts`): request `width: { ideal: 1280 }, height: { ideal: 720 }`
exactly once; stop the old track, clear `srcObject`, and wait 200ms before
re-requesting; serialise `open()` through an in-flight ref so overlapping calls
share or queue rather than race.

**Do not revert:** (1) don't request portrait resolutions, (2) always stop before
re-requesting, (3) keep `open()` serialised.

**Dead ends, confirmed — don't retry these.** CSS and `object-fit` changes (it
was never a display problem); canvas cropping (the field of view is already lost
at capture, so no post-processing recovers it); 90° rotation (frame contents
were upright the whole time); forcing `exact` or `aspectRatio` through
`applyConstraints` (swapped, as above).

Sources: [Snap Camera Kit — Web
Considerations](https://developers.snap.com/camera-kit/integrate-sdk/web/guides/web-considerations),
[Apple Developer Forums #717988](https://developer.apple.com/forums/thread/717988)

---

### WebRTC drops the connection on H.264 B-frames

**Symptom.** The session connected and then immediately failed:
`WebRTC doesn't support H264 streams with B-frames`.

**Fix.** Set the OBS encoder profile to `baseline`. Worth knowing before
blaming the network — the failure looks like an ICE problem and isn't one.

---

### Playback worked everywhere except on mobile data

**Symptom.** On a first real deployment, a test broadcast played fine on desktop
and on the phone over Wi-Fi. On mobile data the page loaded, the player appeared,
and the video stayed black. The server logged the session opening and then:

```
[WebRTC] [session 179eac95] created by 172.56.166.37:38530
[WebRTC] [session 179eac95] closed: deadline exceeded while waiting connection
```

Signalling is HTTP over TCP, so it succeeded and the session was created. Only the
media path failed, which makes this look like a dead server rather than a
connectivity problem.

**Cause.** Debug logging exposed the candidates the phone was offering, and there
were two separate problems in them:

```
2607:fb91:21e7:fb9:...        the phone has an IPv6 address
172.56.166.37 : 24917         and an IPv4 one
172.56.166.37 : 1506          same interface, different port
```

The carrier network is IPv6; the server advertised IPv4 candidates only, so no
pair could form on the address family the phone actually prefers. The IPv4 path
was no better: the same interface reports a different external port on each STUN
query, which is the definition of a symmetric NAT. A port learned from a STUN
server is worthless for reaching anyone else.

**Fix.** Give the server an IPv6 address and advertise it, rather than trying to
punch through the NAT. Direct IPv6 has no NAT to defeat:

```
peer connection established,
  local:  udp/2600:1f18:364:7e00:...:9edf/8189
  remote: prflx/udp/2607:fb91:...:14d9/62255
```

Two details are load-bearing. The media server has to run on the **host network**,
not with published ports: Docker's IPv6 port publishing goes through a userland
proxy that rewrites the source address, and ICE matches candidate pairs by source
address, so it breaks the connection it is meant to forward. And the ICE host list
needs **both** families — dropping IPv6 silently returns to the original failure.

**Lesson.** This is a vertical short-form live app; its audience watches on mobile
data. Every test up to this point had run on localhost or Wi-Fi, and both make the
problem invisible. Testing on the network the product is actually used on is not
the last step of deployment — it is the one that finds the class of bug the earlier
steps cannot.

A TURN server, which the plan had budgeted days for, turned out not to be the
primary answer. It remains as a fallback for viewers with no IPv6 at all.

---

### Demo broadcasts failed with 401 and left no trace

**Symptom.** Every ffmpeg publish died with `Server error: authentication
failed`. The application log showed nothing at all.

**Cause.** The seed script generated stream keys with
`crypto.randomUUID().replace(/-/g, '')`. The auth route's `UUID_RE` accepts
**hyphenated UUIDs only**, so it rejected them before any logging happened.

**Lesson.** `stream_key` is not "any random string" — the UUID shape is part of
the contract between the seed script, the database and the auth route.

---

### A quarter of viewers never received a single packet

**Symptom.** Found by the load test at 10 viewers: 3 of 10 WHEP sessions were
created, then closed with `deadline exceeded while waiting connection`. The
client saw no error. A real viewer would get a black screen. From a home
connection it was 1 in 20; from inside the VPC, 15–27%.

**Cause.** MediaMTX runs with host networking, and `webrtcIPsFromInterfaces`
defaults to on, so it offered **every interface** as an ICE candidate:
`127.0.0.1`, both Docker bridges, and the VPC private address. Clients spent
their connection window on pairs that could never work.

**Fix.** `webrtcIPsFromInterfaces: no`. Candidates now come only from the
configured public hosts (the domain, so a changed IPv4 still resolves, plus the
fixed IPv6). Verified by dumping the SDP answer: only public addresses remain.
150 of 150 viewers connected afterwards.

### A broadcaster couldn't come back, and the first fix was measured wrong

**Symptom.** After a media-server restart, the same stream key got `401` on
every reconnect: `denied: cannot verify publish state`.

**Cause.** The restart lost the `on-unpublish` webhook, so the database still
said `live`. For exactly that case, the auth hook asks MediaMTX whether the path
is really publishing. But MediaMTX calls the auth hook *while handling that
path*, and the path API waits for the hook to answer. The two waited on each
other until the hook's 3-second timeout, which denies.

**The first fix was wrong.** It switched from `paths/get` to `paths/list`,
based on a measurement that called the endpoints one after another. `paths/get`
blocked for 5 s, so by the time `paths/list` ran the auth had already finished,
and it looked fast. Measured concurrently, `paths/list` blocked for 5.5 s too.
Only the connection lists (`rtmpconns`, `webrtcsessions`) answered, in about
2 ms.

**Fix.** Publish state comes from connection lists: a connection with
`state: publish` on that path. A connection waiting on auth shows as `idle` with
no path, so it doesn't count as its own publisher. Checked on production with a
manufactured ghost-live state, and a duplicate publisher is still refused.

**Don't revert.** Never call a path API from inside the MediaMTX auth hook.

### Chrome broadcasters' thumbnails stopped updating

**Symptom.** One broadcaster's thumbnail stayed on a days-old image. The
thumbnail worker logged `1/2 updated` on every tick.

**Cause.** Chrome publishes VP8 by default, and HLS can't carry VP8. MediaMTX
built an audio-only muxer (`converting into HLS, 1 track (Opus)`), and the
worker, which grabs a frame from HLS, had nothing to grab. Phone broadcasts
were fine because iOS Safari sends H.264.

**Fix.** The WHIP publisher calls `setCodecPreferences` with H.264 Constrained
Baseline first and keeps the other codecs as fallbacks.

## Security

### Audit found 13 issues; 5 were proven by running the attack

A full pass over the trust boundaries turned up 13 problems, 12 of which were
fixed. The critical ones were demonstrated, not theorised:

- `add_points` and `send_donation` were `SECURITY DEFINER` **and** had `EXECUTE`
  granted to `anon`. The public anonymous key alone was enough to **mint
  unlimited points and drain other accounts.**
- The `users` UPDATE policy restricted rows but not columns, so any logged-in
  user could rewrite their own `point_balance` and `role`.
- `streams` was world-readable and MediaMTX accepted `user: any` with an empty
  password, which together made **stream hijacking** possible.
- The MediaMTX management API was exposed unauthenticated on all interfaces.

**Structural changes that moved the trust boundary** — these look strange
without the context, so they're easy to undo:

- The MediaMTX path is now `streams.id`, not `stream_key`. **Playback URLs
  therefore contain no secret**, which is deliberate.
- OBS stream key format became `<stream_id>?user=streamer&pass=<stream_key>`.
- Publish authorisation moved to `/api/stream/auth` via `authMethod: http`. That
  route had previously existed but was never wired into the config — dead code.
- `on-publish` / `on-unpublish` verify real publishing state through the
  management API instead of trusting a shared secret.
- Tip alerts are published by the server to a Redis channel and relayed by the
  chat server. **The client-side `donation:send` handler was removed because the
  amount could be forged. Do not bring it back.**

`pnpm verify:security` executes 21 of these attacks and asserts every one fails.
It is meant to be run after touching schema, RLS, media config or the chat
server.

---

### Adding withdrawals would have opened a card-laundering path

**Caught during design, before any code shipped.**

A single `point_balance` held both money paid in by card and money earned from
tips. Attaching withdrawal to that balance completes the loop: **top up with a
card → tip your own second account → withdraw → cash**.

A 20% platform fee is more expensive than the going rate for card laundering
(10–15%), so nobody would use it *today* — but the moment the fee is lowered for
competitive reasons, the product becomes a laundering tool. It needs exactly two
accounts, which puts it out of reach of behavioural detection.

**Fix.** Migration 005 split the balance in two:

| | Increases from | Can be used for |
|---|---|---|
| `point_balance` | card top-ups | tipping only |
| `revenue_balance` | receiving tips | withdrawal only |

`send_donation` debits the sender's `point_balance` and credits the receiver's
`revenue_balance`, in one transaction. Letting revenue be tipped onward would
restore the loop via A→B→A.

**Do not revert:** `send_donation` must never credit the receiver's
`point_balance`. `pnpm verify:payout` asserts this specifically.

---

### Payout ordering, chargebacks and double reversal

- **Chargebacks.** The provider documents that settled payouts are difficult to
  claw back. If a tip payment is reversed after the money has left, it is gone.
  Hence a **14-day hold** — only tips older than that count toward the
  withdrawable balance.
- **Ordering.** `/api/payout/request` debits and records **first**, then calls
  the provider. The reverse order can leave money paid out with no record of it.
- **Double reversal.** Both the failure path and the `payout.changed` webhook can
  call `revert_payout`. Reverting twice would create money, so the function only
  applies to rows still in `REQUESTED` / `IN_PROGRESS` and returns false
  otherwise. The webhook is separately made idempotent through a processed-event
  table.
- **No batching.** The API accepts up to 100 payouts per call, but they are sent
  one at a time: a batch fails as a whole on one bad row and returns only the
  first error, so one person's bad account number would block everyone's payout.

---

## Feed and realtime

### Restarting Redis emptied the feed, permanently

**Symptom.** `live:streams` — the sorted set the feed reads — is written by the
`on-publish` webhook and nowhere else. Flushing Redis with five broadcasts running
left the feed returning `{"data":[],"has_more":false}` while all five were still
publishing, and nothing ever brought them back.

**Cause.** The only event that repopulates the set fires when a broadcast *starts*.
Someone already live generates no further events, so the sole recovery was asking
every streamer to stop and start again. Redis held state with no source of truth
behind it.

**Fix.** Reconcile against the component that actually knows. Redis and Postgres
both hold copies written from webhooks, and webhooks get lost; MediaMTX holds the
sessions themselves. On startup the app asks which paths are publishing and aligns
both copies to that answer — in both directions, so a lost `on-publish` and a lost
`on-unpublish` are corrected by the same pass. It reuses the "ask the media server"
check that already rejects forged webhooks.

Two decisions carry the weight, and both are covered by tests:

- **The sort key is preserved.** That score is the feed cursor. Rewriting it with
  the current time reorders every live stream, so a viewer mid-scroll skips items
  or sees them twice. The original `started_at` is reused, falling back to the
  media server's ready time.
- **An unreachable media server changes nothing.** Treating a failed query as
  "nobody is live" would wipe every publishing stream — causing the outage this
  code exists to repair.

**Lesson.** AOF persistence narrows the window; it does not close it, and it does
nothing for state that drifted rather than vanished. A cache holding data with no
authority behind it needs a path back to the authority, not a better cache.

---

### Ended streams stayed in the feed after a media-server restart

**Symptom.** A stream showed as live in the feed, and tapping it gave a black
screen. Nothing was publishing.

**Cause.** During a media-server restart, `on-unpublish` asks MediaMTX whether the
path is still publishing, gets `ECONNREFUSED`, and leaves the stream `live` in
Postgres and Redis. The reconcile above would have cleared it, but it only ran at
app startup.

**Fix.** Run it at startup and every 60 seconds. Running on a timer means it can
now overlap with `on-publish`, and that changes three rules:

- **Read the copies first, then the authority.** Snapshot Postgres and Redis, then
  ask MediaMTX. `on-publish` writes only after MediaMTX already reports the path,
  so anything live in the snapshot is guaranteed to show up in the later answer.
  In the opposite order, a stream that started between the two reads is marked
  ended.
- **Never rebuild the set.** `DEL` plus rewrite drops a stream that `on-publish`
  added mid-run. Entries are added with `ZADD NX`, which also leaves existing feed
  cursors alone, and only snapshot entries that are no longer publishing are
  removed.
- **A failed read is an error, not an empty answer.** A database error throws
  instead of counting as "nobody is live".

A tick is skipped while the previous one is still running — with Redis down, one
never finishes — and only the first consecutive failure is reported to Sentry, so a
long media-server outage doesn't spend the free quota at one event a minute.

**Measured in production.** Recreating the media-server container during a test
broadcast reproduced it: the ghost was still in the feed 17 seconds later, and the
next tick removed it at 47 seconds.

**Do not revert:** the read order, or `ZADD NX` plus targeted `ZREM` in place of
`DEL`. Either one makes a stream that starts during a reconcile end or vanish.

---

### The feed dead-ended, and swiping gave no feedback at all

**Symptom.** After the last live stream, swiping did nothing — no bounce, no
message. It reads as a broken app rather than as "that's everything". The
Following tab was worse: it returns `has_more: false` unconditionally, so it
dead-ended after two or three streams, **and always will**, at any scale.

**Cause.** With `has_more: false` the loader never runs and the scroll container
simply ends. The "nothing left" state had never been given a screen.

**Fix.** `FeedEndCard` occupies the position after the last stream. With three or
more streams live it continues into them again, ordered by how long each was
actually watched this session, for at most three passes. With fewer, it offers
refresh, explore and streamers to follow instead — cycling between two streams is
transparently a loop and looks more broken than stopping. The same card is now
also the empty state, because two different "nothing here" screens meant only one
of them got exits.

**Do not revert:** the Following tab must not auto-continue into recommendations.
That tab is a filter the viewer chose; the card offers the switch and leaves the
decision to them.

**Lesson.** "Never trap the user" is satisfied by having somewhere to land, not
by making the scroll infinite.

---

### `IntersectionObserver.observe()` re-fires, so the loop appended twice

**Symptom.** Reaching the end card once appended two passes instead of one.

**Cause.** The observer callback was being used as an *event* source. Because the
ref callback is an inline arrow (`ref={(el) => setItemRef(index, el)}`), its
identity changes on every render, so every element is unobserved and re-observed
each time — and **`observe()` invokes the callback again for elements that are
already intersecting.** React StrictMode doubles that again in development.
Four calls, two appended passes.

**Fix.** Each card carries its pass number (`data-pass`); a ref holds the highest
pass already handled, so the effect runs once per card no matter how often the
observer fires.

**Lesson.** Observer callbacks report *state*, not *events*. Any side effect
triggered from one has to be idempotent.

---

### The stream you just watched was ranked as if you hadn't

**Symptom.** Repeat passes are ordered by watch time, but the stream watched
immediately before reaching the end card always sorted last.

**Cause.** Arrival at the card is detected in the observer callback, which runs
immediately; the dwell timer is closed in an effect reacting to the active index,
which runs after. At ordering time the last stream's dwell was still open and
read as zero — and that is precisely the stream the viewer was most engaged with.

**Fix.** Close the current dwell explicitly before computing the order.

**Lesson.** When a callback and an effect touch the same value, do not assume
which runs first.

---

### The tip button existed, rendered, and could not be clicked

**Symptom.** The tip sheet accepted an amount and a message, but the send button
was nowhere on screen and the sheet would not scroll. There was no way to
complete a tip at all.

**Cause.** `DonationPanel` and `BottomNav` were **both `z-50`**, and the nav comes
later in the DOM, so it won. The overlap landed exactly on the send button at the
bottom of the sheet. `getBoundingClientRect()` confirmed the button was present
and correctly positioned — visually it just looked absent.

**Fix.** Raised the sheet to `z-[70]`, matching the moderation and report sheets
that were already there, so there is now one modal layer rather than three
opinions.

**Do not revert** modals to `z-50`; they land back under the nav.

**Lesson.** Nothing verified that the revenue path was *clickable*. Rendering and
being reachable are different properties.

---

### Watching a live stream removed the only way to navigate

**Cause.** `ChatWindow` (z-20) was being covered by `BottomNav` (z-50), and the
chosen workaround was to not render the nav at all while a stream was playing.
That solved the overlap by removing every in-app navigation route.

**Fix.** Stop overlapping instead of restacking. `BottomNav` exports its height,
the feed page passes it down as a `--bottom-nav-h` CSS variable, and `ChatWindow`
sits above it. On pages without the variable it resolves to 0.

**Do not revert** to hiding the nav.

---

### A stream ended and the viewer was stuck on a frozen screen

**Cause.** `FeedItem` called `onRemove?.(stream.id)`, but `SwipeFeed` never passed
the prop and `useFeed` had no removal function at all. **Optional chaining
swallowed it silently** — no error, no warning, just nothing.

**Fix.** Wired `useFeed.removeStream` → `SwipeFeed.onRemove` → `FeedItem`, with a
2.5s notice before removal and a manual "skip now" button in case the automatic
move fails.

---

### Viewers could not hear anything, structurally

**Cause.** `<video muted>` in the player and `video.muted = true` in the WebRTC
hook both forced mute for autoplay-policy reasons, and **no unmute control was
ever built**. Sound could not reach a viewer under any circumstances.

**Fix.** Start muted (policy) with a visible toggle, and persist the choice in
`localStorage` so it survives swiping between streams.

**Note:** the broadcaster's own preview must stay muted or it feeds back.

---

### Swiping didn't start the next stream

**Symptom.** Scrolling from the first stream to the second left the second on
its thumbnail. The first kept playing off-screen. Opening the same stream from
Explore worked.

**Cause.** Each item registers itself with the IntersectionObserver from a ref
callback, and the observer is created in an effect. Ref callbacks run
**before** effects, so on the first render every item tried to register with an
observer that didn't exist yet, and `observer?.observe(el)` quietly did nothing.
It only worked when some later re-render re-ran the refs, which made it
intermittent.

**Fix.** Right after creating the observer, observe every item that has
already registered.

### Chat said "Connecting…" forever

**Symptom.** On an iPhone, chat never connected and the server logged nothing.

**Cause.** The socket hook had no failure state. With no session it returned
without creating a socket. A token rejected by the server's auth middleware
isn't retried by Socket.IO, and there was no `connect_error` handler. After five
failed reconnects it gave up. All three looked like the same spinner. Here the
phone had simply been logged out.

**Fix.** Explicit `connecting / connected / signed-out / failed` states, one
token refresh and reconnect on rejection, and a login link or retry button in
place of the spinner. The chat server now logs each rejection and its reason.

## Platform and tooling

### The app loaded on a phone but no button worked

**Symptom.** Over the LAN, HTML arrived and rendered, but nothing was
interactive. No error, no spinner, no failed-request indication.

**Cause.** Next.js 16 blocks `/_next/static` requests from non-localhost origins
by default. The markup was served, the JS chunks were refused, and React never
hydrated.

**Fix.** Populate `allowedDevOrigins` at startup from `os.networkInterfaces()`.

**Do not hardcode the IP** — it changes with the network and the failure returns
in exactly the same silent form.

---

### Hydration mismatch that was not our bug

**Symptom.** `A tree hydrated but some attributes of the server rendered HTML
didn't match`, on the login and signup pages only. The single differing attribute
was `__gcruniqueid`, and only on `<form>` and the email/password inputs.

**Cause.** A password-manager browser extension injecting attributes into the DOM
**before** React hydrates. The login page has no `Date.now()`, no
`typeof window` branch and no locale formatting — there was nothing on our side
that could differ.

**Fix.** `suppressHydrationWarning` on the auth form and its inputs. The React
team treats this as the intended escape hatch for exactly this case
([facebook/react#25924](https://github.com/facebook/react/issues/25924)). It
applies to **one level only**, so it has to go on the form and each input
individually. `ChatInput` is deliberately excluded — applying it broadly would
hide real mismatches.

---

### Verification scripts read an env file that doesn't exist

**Symptom.** `pnpm payout:check` reported keys as unset when they were set.

**Cause.** `import 'dotenv/config'` loads **`.env` only**. This project uses
`.env.local`. An older script had `config({ path: '.env.local' })` and the new
one didn't follow it.

**Fix.** Both scripts now pass the path explicitly.

**Convention:** anything new in `scripts/` must use
`config({ path: '.env.local' })`. Importing `dotenv/config` fails by reporting
"not configured", which is a much worse failure than an error.

---

### Profile creation was rejected by its own RLS policy

**Symptom.** `new row violates row-level security policy for table users` on
signup.

**Cause.** The client inserted the profile immediately after `signUp()`, before
the session was fully established, so `auth.uid()` was still null. RLS was
working correctly.

**Fix.** A database trigger creates the profile on `auth.users` insert, reading
the nickname from `raw_user_meta_data`. The client-side insert was removed.

---

### Smaller ones

| Problem | Cause | Fix |
|---|---|---|
| `useRef<T>()` fails to compile | React 19 requires an initial value | `useRef<T>(undefined)` |
| MediaMTX won't bind its ports | macOS `httpd` on 8888, `mysqld` on 8889 | HLS → 8890, WebRTC → 8891 |
| HLS sub-manifest requests rejected | Playback auth applied to every request | Read action allowed in `/api/stream/auth` |
| MediaMTX container can't call webhooks | No `curl` in the image | Added in `Dockerfile.mediamtx` |
| `DATABASE_URL` fails to parse | `@`, `]`, `%` in the password | Password without URL-reserved characters |
| Postgres direct connection refused | Direct endpoint is IPv6-only | Session pooler endpoint |
| Camera preview looked zoomed in | `object-cover` cropping 9:16 into a 9:19.5 viewport | `object-contain` for both preview and player — changing only one makes the broadcaster's framing differ from the viewer's |
| `format.dateTime(d, 'short')` throws | next-intl ships no named formats | Declare `short` and `full` in `i18n/request.ts` |

---

## Operations and deployment

### The deploy pipeline had never deployed anything

**Symptom.** A merge wasn't live ten minutes later. The server was three merges
behind. The earlier ones were docs-only, so nobody had noticed.

**Cause.** Three layers, each hiding the next:
1. The systemd timer was installed but never enabled.
2. Enabled, it would have failed anyway: it runs as root, the repo is owned by
   `ubuntu`, and git refused with `dubious ownership`.
3. Past that, the change check compared `compose images` before and after
   `pull`, which lists the images of *running* containers. They were always
   equal, so it never swapped anything.

**Fix.** Scoped `safe.directory`, and no comparison at all: `up -d` already
recreates only services whose image or config changed. Verified end to end: the
next merge was picked up by the timer, which replaced only the app container.

**Lesson.** "The pipeline exists" is not done. Done means watching one merge
arrive on the server.

### Config file changes never reached the running containers

**Cause.** `mediamtx.yml` and the `Caddyfile` are bind-mounted. After a pull,
compose sees an identical container definition and does nothing. Git also
writes the changed file as a new inode, and the running container keeps the
old one.

**Fix.** The deploy script diffs the pulled commits for those files and
force-recreates only the matching service.

### With Redis down, the app hung instead of reporting it

**Cause.** The startup hook awaited the live-set reconcile. Next.js serves
nothing until that hook resolves, and ioredis queues commands until it
reconnects. So `/api/health`, the endpoint meant to report `redis: false`,
never answered at all.

**Fix.** The reconcile runs in the background. With Redis unreachable, health
now answers in 3 s with `503 {redis: false}`.

### Smaller ones

- **The uptime monitor saw the chat server as down.** The Socket.IO handshake
  URL answers `HEAD` with 400, and monitors send `HEAD`. Chat now has its own
  `/health`.
- **A rollback test took production chat monitoring down for 8 minutes.** The
  test was meant to show that a commit with no images gets refused. That
  commit's cancelled build had in fact pushed images, so the rollback ran and
  removed `/health`. The script now lists the commits that would leave
  production and asks first. Test "must fail" paths against the nearest
  harmless target.

## Still open

**OBS audio over RTMP is silent.** MediaMTX logs `skipping track 2 (MPEG-4 Audio)`
— WebRTC does not carry AAC, only Opus, and OBS sends AAC over RTMP. An earlier
note here said switching OBS's audio codec to Opus would fix it, but nothing in the
MediaMTX docs says its RTMP input accepts Opus, so that was never a confirmed fix.
The documented path is WHIP: OBS's WHIP output sends Opus, and MediaMTX passes the
bearer token OBS sends to the auth hook as `token`. `/api/stream/auth` used to read
only `password` and would have rejected every OBS WHIP publish; it now accepts
either, and the dashboard shows the WHIP URL and token. **Not yet verified with a
real OBS**, so this stays open until it is. Phone broadcasting is unaffected
because browsers send Opus.

**LTE black screen on iPhone for RTMP (OBS) streams, intermittently.** ICE
connects over IPv6, but no picture appears. That one session pulls 13–17× the
stream bitrate in retransmissions, and it works on Wi-Fi. Ruled out by
measurement: the ICE fix above, server load, bitrate and resolution, packet size
(max 1,216 B payload, inside the IPv6 minimum MTU), burstiness (browser-published
streams burst *more* and play fine), and the IPv6 path itself. It didn't reproduce
the next day. A capture of a working session is kept for comparison. Separately,
nothing caps retransmission: one such viewer costs as much egress as ~15 normal
ones. MediaMTX exposes no setting for it (every `webrtc*` option checked), so a cap would need a proxy in
front of it or a different media server.

**No adaptive bitrate.** Viewers get whatever the broadcaster sends. MediaMTX has
no simulcast or per-viewer layer selection, and transcoding on the server would
spend the CPU headroom measured in the load test (the media server only forwards
packets today).

**Payout provider is not approved yet.** The code is complete and the fee
arithmetic is verified, but `pnpm payout:check` returns HTTP 403
`FORBIDDEN_REQUEST` — the secret key authenticates (it is not a 401), the service
simply isn't enabled on the account. Seller registration and a real payout round
trip have therefore never run. Legal review is also outstanding: whether the
points constitute a regulated prepaid payment instrument, AML obligations, VAT
timing on top-ups, and the identity data required for tax withholding statements.

**Tailwind's `text-black` doesn't apply to the chat input.** Worked around with
an inline style. **Root cause not established** — it is listed here rather than
in the fixed section for that reason.
