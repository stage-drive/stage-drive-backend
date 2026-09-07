FROM node:22-alpine AS deps
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat
RUN npm install -g npm@11.6.1

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app

COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x docker-entrypoint.sh \
  && mkdir -p uploads/avatars uploads/logos

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
