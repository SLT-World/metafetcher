# Metafetcher
A basic, lightweight **link preview API** initially designed for rendering link embeds in SLChat.

## Features
- Supports [OpenGraph](https://ogp.me/) and [Twitter Card](https://developer.x.com/en/docs/x-for-websites/cards/overview/markup) metadata formats.
- Returns a clean, basic JSON structure with missing fields as null.
- No Selenium or browser automation used.
- Optional raw `<head>` extraction mode.

## Deployment
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/SLT-World/metafetcher)


## Usage
### Basic
Request:
```
/?url=https://www.planetminecraft.com/
```
Response:
```json
{
  "site": "Planet Minecraft",
  "title": "Planet Minecraft Community | Creative fansite for everything Minecraft!",
  "description": "Planet Minecraft is a family friendly community that shares and respects the creative works and interests of others. We have a variety of entertaining...",
  "image": "https://www.planetminecraft.com/images/layout/themes/modern/planetminecraft_logo.png",
  "theme": "#3366CC"
}
```
### Raw `<head>`
Request:
```
/?raw=true&url=https://ogp.me/
```
### Firefox User Agent
Request:
```
/?discord=false&url=https://ogp.me/
```

## History
Originally developed as a subproject in the [SLChat-External](https://github.com/SLT-World/SLChat-External/commit/5f63b720c03b69ecb502314d0ea59554d3982a91) repository to reduce SLChat's reliance on third-party services.

It was later moved to this repository to prevent unnecessary Cloudflare build triggers on unrelated commits within [SLChat-External](https://github.com/SLT-World/SLChat-External/).