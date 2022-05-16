FROM node:14.14.0-alpine

# hadolint ignore=DL3018
RUN apk --no-cache add --update python make g++\
   && rm -rf /var/cache/apk/*

WORKDIR /chain-hook

COPY ./package.json .
RUN npm i

COPY . .

EXPOSE 5000

CMD ["npm", "run", "start"]
