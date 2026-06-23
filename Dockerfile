# Dockerfile for the my-ax Sandbox container.
#
# Per https://developers.cloudflare.com/sandbox/configuration/dockerfile/ —
# we extend Cloudflare's official sandbox base image. The version MUST match
# our @cloudflare/sandbox npm version (currently 0.12.1); a mismatch means
# the in-container HTTP server speaks a different protocol than the SDK.
#
# Container ships with a deliberately lean utility baseline for the agent's
# durable /home/user workspace. Repository mounting, Git checkouts, and
# self-deployment CLIs are intentionally absent: my-ax is not a self-development
# environment.
FROM docker.io/cloudflare/sandbox:0.12.1

# Required for `wrangler dev` local development. Without this EXPOSE, the
# Worker can't talk to the local container and we get
#   "connect(): Connection refused: container port not found"
# even though the container's API server IS listening on :3000. In prod
# every port is auto-exposed and this directive is a no-op. See
# https://developers.cloudflare.com/containers/local-dev/#exposing-ports
EXPOSE 3000

# Lean cloud-computer baseline. Durability belongs to /home/user snapshots and
# user-local installs, not apt writes or hidden image drift.
# Keep install layers modest: very large compressed layers have repeatedly
# timed out while committing to Cloudflare Container Registry. Each command
# refreshes/removes apt metadata so the resulting layers remain reproducible.
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends \
      ca-certificates curl jq procps python3 ripgrep sqlite3 iproute2 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN apt-get update -qq \
    && apt-get install -y -qq --no-install-recommends \
      unzip xz-utils zip \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Modern Python/user-tool path. Install uv as a small pair of static binaries;
# uv-managed tools can live under /home/user and persist with workspace backups.
COPY --from=ghcr.io/astral-sh/uv:0.11.6 /uv /uvx /usr/local/bin/

# Keep /home/user empty in the image. Runtime workspace restore repopulates
# it from the latest Sandbox backup when available; otherwise users get a
# clean fast local workspace that future snapshots make durable.
RUN rm -rf /home/user && mkdir -p /home/user

# ─── Per-user shell experience ───────────────────────────────────────────────
# Point XDG-aware CLIs at /home/user/.config so their state is part of the
# user workspace and its Sandbox snapshots instead of /root's container layer.
# /home/user/.local/bin is where uv-managed user tools live (persists via snapshots).
ENV PATH=/home/user/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV XDG_CONFIG_HOME=/home/user/.config

# Default shell prompt. ENV ACCESS_EMAIL is injected per-session by the Worker
# (see workspace.ts) so the shell shows the actual authenticated user, e.g.
# "you@my-ax: /home/user $ ". Falls back to "user@my-ax" if unset.
ENV HOSTNAME=my-ax
# Append to /root/.bashrc (NOT /etc/bash.bashrc) because the latter is
# sourced before user bashrc, and the system /etc/bash.bashrc has a
# `PS1='\u@\h:\w\$ '` line near the top that wins over any append at the
# bottom of the same file (proven 2026-05-11). User-level ~/.bashrc is
# sourced LAST for interactive non-login shells, so PS1 there wins.
# Sandbox container runs as root, so /root/.bashrc is the right path.
RUN echo '' >> /root/.bashrc \
 && echo '# my-ax: per-session prompt + cd to shared workspace' >> /root/.bashrc \
 && echo 'ACCESS_EMAIL_SHORT="${ACCESS_EMAIL%%@*}"' >> /root/.bashrc \
 && echo 'export ACCESS_EMAIL_SHORT' >> /root/.bashrc \
 && echo 'export PS1="\[\e[36m\]${ACCESS_EMAIL_SHORT:-user}\[\e[90m\]@my-ax\[\e[0m\]:\[\e[33m\]\w\[\e[0m\] \$ "' >> /root/.bashrc \
 && echo 'cd /home/user 2>/dev/null || true' >> /root/.bashrc

