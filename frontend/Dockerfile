# Dependency stage for development
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm config set strict-ssl false && npm install --include=dev

# Build stage
FROM deps AS build
COPY . .
RUN npm run build

# Production stage
FROM nginx:1.26-alpine
COPY --from=build /app/dist /usr/share/nginx/html

# Ghi đè file default.conf mặc định của nginx:1.25-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
