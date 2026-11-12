# Controlled image template for static department websites.
# Uploaded content is COPY'd only — there are no RUN steps and uploaded Dockerfiles are never used.
# BASE_IMAGE should be pinned by digest in production (see docs/security.md).
ARG BASE_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine
FROM ${BASE_IMAGE}
# Built with the daemon's classic builder (no BuildKit helper containers). The worker writes the context
# with 0644 files / 0755 dirs; root ownership keeps the content read-only for the nginx user (101).
COPY --chown=root:root default.conf /etc/nginx/conf.d/default.conf
COPY --chown=root:root site/ /usr/share/nginx/html/
USER 101
EXPOSE 8080
