FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Environment variables for build time (Vite)
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
