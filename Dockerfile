FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/app/data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY package.json ./
VOLUME /app/data
EXPOSE 8787
CMD ["node", "server/index.mjs"]
