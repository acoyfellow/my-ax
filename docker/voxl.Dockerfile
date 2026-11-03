FROM docker.io/cloudflare/sandbox:0.12.14 AS voxl-build
ARG VOXL_VERSION=0.3.2
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends curl ca-certificates build-essential pkg-config clang libclang-dev \
       libx264-dev libyuv-dev libopus-dev libpulse-dev libx11-dev libxext-dev libxdamage-dev libxfixes-dev libxtst-dev libxrandr-dev libxcomposite-dev libxkbcommon-dev esbuild \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH=/root/.cargo/bin:$PATH
RUN cargo install --locked voxl-server --version ${VOXL_VERSION} --root /opt/voxl

FROM docker.io/cloudflare/sandbox:0.12.14
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends libx264-dev libyuv0 libopus0 libpulse0 xvfb \
    && rm -rf /var/lib/apt/lists/*
COPY --from=voxl-build /opt/voxl/bin/voxl /usr/local/bin/voxl
RUN voxl --version
