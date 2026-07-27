# --- Build stage -----------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /build

# Copy manifests first so the dependency layer is cached and only reinstalls when they change.
COPY app/package.json app/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY app/ ./
# `npm run build` typechecks before bundling, so a type error fails the image build rather
# than shipping.
RUN npm run build


# --- Runtime stage ---------------------------------------------------------------------
FROM nginx:alpine

# The app is entirely static: there is no server-side code, no database and no volume, so
# uploaded files cannot outlive the browser tab they were opened in.
COPY --from=build /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Deliberately outside conf.d, which nginx auto-includes at http level; this file is
# include-d explicitly by every location block. See the comment in nginx-headers.conf.
COPY nginx-headers.conf /etc/nginx/security-headers.conf

EXPOSE 8477

# nginx:alpine has no curl; wget is present in busybox.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8477/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
