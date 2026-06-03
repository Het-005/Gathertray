FROM ruby:3.3-slim

WORKDIR /app

COPY . /app

EXPOSE 4567

ENV PORT=4567
ENV GATHERTRAY_BIND=0.0.0.0
ENV GATHERTRAY_DATA_FILE=/app/data/store.json

CMD ["ruby", "server.rb"]
