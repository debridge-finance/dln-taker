FROM node:18.12.1 as builder


WORKDIR /build

COPY package.json /build
COPY package-lock.json /build
RUN npm install



COPY tsconfig.json /build
COPY tsconfig.base.json /build
COPY tsconfig.cjs.json /build
COPY tsconfig.esm.json /build
COPY src  /build/src

FROM node:18.12.1-alpine
WORKDIR /app
COPY --from=builder /build/node_modules /app/node_modules
COPY --from=builder /build/package.json /app
COPY --from=builder /build/package-lock.json /app
COPY --from=builder /build/tsconfig.json /app
COPY --from=builder /build/tsconfig.base.json /app
COPY --from=builder /build/tsconfig.cjs.json /app
COPY --from=builder /build/tsconfig.esm.json /app
COPY --from=builder /build/src  /app/src
COPY debridge.config.ts /app

CMD npm run executor debridge.config.ts
