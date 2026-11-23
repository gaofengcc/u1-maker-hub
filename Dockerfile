# syntax=docker/dockerfile:1
# U1 Maker Hub with OrcaSlicer bundled. OrcaSlicer only ships x86_64 Linux builds,
# so the image is linux/amd64 (it runs under emulation on ARM hosts, slowly).

ARG ORCA_VERSION=2.4.2
ARG NODE_IMAGE=node:22-bookworm-slim

# ---- OrcaSlicer: unpack the AppImage's squashfs without running it ----
# The squashfs starts right after the ELF runtime, at e_shoff + e_shentsize * e_shnum.
# Not executing the AppImage keeps this stage working on any build machine, ARM included.
FROM --platform=$BUILDPLATFORM ubuntu:24.04 AS orca
ARG ORCA_VERSION
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends ca-certificates curl squashfs-tools \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/orca.AppImage \
      "https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v${ORCA_VERSION}/OrcaSlicer_Linux_AppImage_Ubuntu2404_V${ORCA_VERSION}.AppImage" \
 && f=/tmp/orca.AppImage \
 && shoff=$(od -An -t u8 -j 40 -N 8 $f | tr -d ' ') \
 && shentsize=$(od -An -t u2 -j 58 -N 2 $f | tr -d ' ') \
 && shnum=$(od -An -t u2 -j 60 -N 2 $f | tr -d ' ') \
 && unsquashfs -q -n -o $((shoff + shentsize * shnum)) -d /opt/orcaslicer $f \
 && rm $f \
 && test -x /opt/orcaslicer/AppRun

# ---- App build ----
FROM --platform=linux/amd64 ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

# ---- Runtime: Ubuntu 24.04, which OrcaSlicer's Linux build targets ----
FROM --platform=linux/amd64 ${NODE_IMAGE} AS node
FROM --platform=linux/amd64 ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
# Libraries OrcaSlicer loads even for the headless command line.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      ca-certificates locales \
      libgtk-3-0t64 libwebkit2gtk-4.1-0 libgl1 libglu1-mesa libegl1 libopengl0 \
      libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 libmspack0t64 libsecret-1-0 \
      libsoup-3.0-0 libsm6 libice6 libwayland-egl1 \
 && locale-gen en_US.UTF-8 >/dev/null \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=orca /opt/orcaslicer /opt/orcaslicer
COPY --from=build --chown=1000:1000 /app /app

# Settings, Bambu token, favourites, downloads and jobs live in /data.
# OrcaSlicer writes its own config under $HOME, so HOME points there too.
RUN mkdir -p /data && chown 1000:1000 /data && chmod 700 /data
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    LANG=en_US.UTF-8 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    HOME=/data \
    SLICER_APP=/opt/orcaslicer

USER 1000:1000
WORKDIR /app
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
