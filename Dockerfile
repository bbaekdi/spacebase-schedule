FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3000
EXPOSE 41234/udp
ENV TZ=Asia/Seoul
CMD ["node", "server.js"]
