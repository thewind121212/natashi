# syntax=docker/dockerfile:1.5
ARG RUNTIME_BASE_IMAGE=linhdevtran99/natashi-base:latest

FROM golang:1.22-bookworm AS go-build
ENV GOTOOLCHAIN=auto
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /out/playground cmd/playground/main.go

FROM node:22-bookworm AS node-build
WORKDIR /app

COPY app/package*.json app/
RUN npm ci --prefix app
COPY app app
RUN npm run --prefix app build

COPY playground/package*.json playground/
RUN npm ci --prefix playground
COPY playground playground

ARG VITE_API_BASE_URL
ARG VITE_WS_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
RUN npm run --prefix playground build

RUN rm -rf app/public && mkdir -p app/public && cp -R playground/dist/* app/public/

FROM ${RUNTIME_BASE_IMAGE} AS runtime

ARG INSTALL_MEDIA_TOOLS=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && if [ "${INSTALL_MEDIA_TOOLS}" = "1" ]; then \
       apt-get install -y --no-install-recommends ffmpeg yt-dlp; \
     fi \
  && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app
COPY --from=go-build /out/playground /usr/local/bin/playground
COPY --from=node-build /app/app/dist /app/app/dist
COPY --from=node-build /app/app/public /app/app/public
COPY --from=node-build /app/app/package*.json /app/app/
COPY scripts /app/scripts

RUN npm ci --omit=dev --prefix /app/app
RUN chmod +x /app/scripts/docker-entrypoint.sh

ADD https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp /usr/local/bin/yt-dlp
RUN chmod +x /usr/local/bin/yt-dlp

ENV NODE_ENV=production
ENV WEB_AUDIO=1

EXPOSE 3000 5173

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
