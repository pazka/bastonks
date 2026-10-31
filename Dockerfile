# bastonks — one static binary (deno compile) in a distroless image, uid 10001. Box contract rules 1–4, 12.
# Base images pinned by digest (Dependabot keeps them fresh, with a cooldown).

FROM denoland/deno:debian-2.9.8@sha256:a0d88a7fcbd44f062cba2748e19df67d30290ad12aa203c7c1e0b12462c483f0 AS build
WORKDIR /src
# Dependencies first (frozen lockfile, minimum age, no install scripts — see deno.json / .npmrc).
# The optional `ca` secret is only for builders behind a TLS-intercepting proxy; CI does not use it.
COPY deno.json deno.lock .npmrc ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export DENO_CERT=/run/secrets/ca; fi; deno ci
COPY . .
# The runtime `deno compile` wraps, pinned by checksum (instead of an unpinned download at compile time).
ADD --checksum=sha256:ab416b7470f3f7c6d7b4363be475e5d8cf3d8469d866b3b8459a332a5874cd0d \
    https://github.com/denoland/deno/releases/download/v2.9.7/denort-x86_64-unknown-linux-gnu.zip /tmp/denort.zip
RUN deno run --allow-read=/tmp --allow-write=/tmp scripts/unzip1.ts /tmp/denort.zip /tmp/denort
ENV DENORT_BIN=/tmp/denort
# Front-end bundle embedded into the server, then a single binary with its permissions compiled in.
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export DENO_CERT=/run/secrets/ca; fi; deno task build && deno task compile
RUN mkdir -p /out/data && chown 10001:10001 /out/data && chmod 700 /out/data

FROM gcr.io/distroless/cc-debian12:nonroot@sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="bastonks" \
      org.opencontainers.image.source="https://github.com/pazka/bastonks" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
COPY --from=build --chown=10001:10001 /out/data /data
COPY --from=build /src/dist/bastonks /app/bastonks
ENV APP_DATA_DIR=/data
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["/app/bastonks", "healthcheck"]
ENTRYPOINT ["/app/bastonks"]
CMD ["serve"]
