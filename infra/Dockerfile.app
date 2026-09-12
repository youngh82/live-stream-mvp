# Next.js 앱 서버.
#
# ⚠️ NEXT_PUBLIC_* 는 런타임 환경변수가 아니라 **빌드 시점에 번들에 박힌다.**
#    그래서 ARG로 받는다. 이 값들을 바꾸려면 이미지를 다시 빌드해야 한다 —
#    compose의 environment에만 넣고 build args를 빠뜨리면, 배포된 앱이
#    localhost로 WHEP/WebSocket을 찌르면서 조용히 실패한다.
#
# ⚠️ `output: 'standalone'`을 쓰지 않는다. pnpm과 함께 쓰면 Next의 파일 추적이
#    전이 의존성을 놓쳐, 이미지는 멀쩡히 빌드되고 **컨테이너를 띄우는 순간**
#    `MODULE_NOT_FOUND: @swc/helpers/esm/_interop_require_default.js`로 죽는다.
#    node-linker를 hoisted로 바꿔도 standalone 출력은 여전히 .pnpm 경로를 가리킨다.
#    이미지가 290MB에서 커지는 대신 확실히 뜨는 쪽을 택했다.
#    (standalone을 다시 시도한다면, 빌드 성공이 아니라 **컨테이너 실행**으로 확인할 것)
#
# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ── 의존성 ────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# 런타임용 의존성만. devDependencies(typescript·eslint·vitest·esbuild)는
# 빌드가 끝나면 필요 없고, 그것만 빼도 이미지가 절반 이하로 줄어든다.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ── 빌드 ──────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_HLS_BASE_URL
ARG NEXT_PUBLIC_WHEP_BASE_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_RTMP_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
# 소스맵 업로드 대상. 공개 값이라 build arg로 받는다 (토큰은 아래 secret)
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_HLS_BASE_URL=$NEXT_PUBLIC_HLS_BASE_URL \
    NEXT_PUBLIC_WHEP_BASE_URL=$NEXT_PUBLIC_WHEP_BASE_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_RTMP_URL=$NEXT_PUBLIC_RTMP_URL \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    NEXT_TELEMETRY_DISABLED=1

# Sentry 소스맵 업로드 토큰은 **build arg가 아니라 secret mount**로 받는다.
# build arg·ENV는 이미지 히스토리에 남아 이미지를 받은 누구나 읽을 수 있다.
# secret은 이 RUN 한 줄 동안만 파일로 보이고 레이어에 남지 않는다.
# 토큰이 없으면(로컬 빌드) 파일이 없어 빈 값이 되고, 업로드만 건너뛴다.
RUN --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    pnpm build

# ── 실행 ──────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs package.json next.config.ts tsconfig.json ./
COPY --chown=nextjs:nodejs src/i18n ./src/i18n
COPY --chown=nextjs:nodejs messages ./messages

USER nextjs
EXPOSE 3000

# Redis·Postgres·MediaMTX를 각각 확인한다. 하나라도 죽으면 503.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/next", "start"]
