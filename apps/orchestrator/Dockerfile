FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev

FROM node:22-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY --from=deps /app/node_modules node_modules/
COPY --from=builder /app/dist dist/
COPY package.json ./
COPY drizzle/ drizzle/
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
