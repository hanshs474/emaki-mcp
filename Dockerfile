# Build the MCP server, then run it over stdio.
# Glama builds this image, starts the server, and sends MCP introspection
# (initialize + tools/list) — no network or auth needed to pass checks.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# stdio MCP server
ENTRYPOINT ["node", "dist/index.js"]
