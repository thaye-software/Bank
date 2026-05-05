FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build:server

EXPOSE 3000

# db push creates the schema, seed loads dev fixtures, then start the server
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx prisma/seed.ts && node dist/server.js"]
