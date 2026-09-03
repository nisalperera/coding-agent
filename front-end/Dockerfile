# front-end/Dockerfile
#
# Serves the static SPA with nginx. Two changes from the previous version:
#   1. Listens on 3000 -- nginx:alpine's default vhost already
#      binds 80; overriding EXPOSE alone never changed the actual listen
#      port, so the old image silently served on 80 regardless of EXPOSE.
#      This version ships its own server block that actually listens on
#      the documented port.
#   2. Adds an SPA fallback (try_files ... /index.html) so client-side
#      routes like /callback/github and /callback/gitlab, which this app
#      handles in main.js via window.location.pathname, don't 404 on a
#      hard refresh or direct link.
FROM nginx:1.27-alpine

# COPY ./local/docker-entrypoint.sh /docker-entrypoint.d/40-inject-app-config.sh
# RUN chmod +x /docker-entrypoint.d/40-inject-app-config.sh
COPY ./local/nginx.conf /etc/nginx/conf.d/default.conf
COPY ./local /usr/share/nginx/html
COPY ./assets/ /usr/share/nginx/html/assets

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:3000/ >/dev/null 2>&1 || exit 1
