FROM node:24-slim

# LibreOffice para convertir DOCX a PDF ("Ver Informe"); build tools por si
# better-sqlite3 no encuentra binario precompilado para esta plataforma.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    fonts-dejavu \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

ENV LIBREOFFICE_PATH=/usr/bin/soffice

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
