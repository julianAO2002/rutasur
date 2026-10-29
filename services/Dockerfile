# Una sola imagen para todos los servicios Node.js; cada contenedor elige su proceso con "command".
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production KAFKAJS_NO_PARTITIONER_WARNING=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
USER node
CMD ["node", "src/simulador/index.js"]
