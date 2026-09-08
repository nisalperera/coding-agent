FROM nginx:1.27-alpine

COPY ./local/nginx.conf /etc/nginx/conf.d/default.conf
COPY ./local /usr/share/nginx/html
COPY ./assets/ /usr/share/nginx/html/assets

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:3000/ >/dev/null 2>&1 || exit 1
