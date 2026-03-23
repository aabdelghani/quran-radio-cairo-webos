# Quran Radio Cairo - LG webOS TV App

إذاعة القرآن الكريم من القاهرة

Streams Holy Quran Radio from Cairo on LG webOS TVs with live "Now Playing" schedule.

## Features

- HLS live stream from the official source (misrquran.gov.eg)
- Fallback stream via Zeno.fm if primary fails
- Live "يعرض الآن" (Now Playing) pulled from the official API
- TV remote support (Enter/OK to play/stop)

## Now Playing API (يعرض الآن)

The app fetches the current program schedule from the official misrquran.gov.eg API.

### Endpoint

```
POST https://API.misrquran.gov.eg/api/RadioProgrammeSchedule/GetByDay
```

### Request

- **Method:** POST
- **Content-Type:** application/json
- **Authentication:** None required
- **Body:**
```json
{
  "Date": null
}
```

Passing `null` returns today's schedule. You can also pass a specific date string.

### Response

```json
{
  "count": 0,
  "data": [
    {
      "id": "uuid",
      "day": "2026-03-23T00:00:00",
      "fromTime": "01:00 AM",
      "toTime": "01:30 AM",
      "title": "المصحف المرتل للقارئ الشيخ مصطفى إسماعيل",
      "description": "{ وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا } المزمل 4",
      "imageURL": "https://quoranmediastg.blob.core.windows.net/quraanradio/...",
      "episodesUrl": "null",
      "radioProgrammeId": "uuid",
      "nodeId": "uuid",
      "entityStatus": 4,
      "notify": false
    }
  ]
}
```

### How we determine "Now Playing"

The API returns the full day's schedule. Each program has `fromTime` and `toTime` in 12-hour format (e.g. `"01:30 AM"`). The app:

1. Fetches the schedule on load and every 60 seconds
2. Parses each program's time window
3. Compares against current Cairo time (UTC+2)
4. Displays the matching program as "يعرض الآن"

### How this API was discovered

The official website at `https://misrquran.gov.eg/home` is a Vue.js SPA. The stream URL and API endpoints were found by inspecting the bundled JavaScript at `https://misrquran.gov.eg/js/app.js`:

```bash
# Find the HLS stream URL
curl -sL "https://misrquran.gov.eg/js/app.js" | grep -oP 'https?://[^"]+\.m3u8[^"]*'

# Find all API endpoints
curl -sL "https://misrquran.gov.eg/js/app.js" | grep -oP '/api/[A-Za-z/]+'
```

**Endpoints found:**
| Endpoint | Auth Required | Purpose |
|---|---|---|
| `RadioProgrammeSchedule/GetByDay` | No | Today's schedule |
| `ItemCurrentTime/GetItemsWithCurrentTime` | Yes (Bearer) | Playback progress |
| `MediaService/GetVideoHlsUrl` | Yes (Bearer) | Video HLS URLs |
| `Events/GetAllByYear` | Yes (Bearer) | Yearly events |

The schedule endpoint is the only one that works without authentication, which is what we use for "يعرض الآن".

## Stream URL

**Primary (HLS):**
```
https://service.webvideocore.net/CL1olYogIrDWvwqiIKK7eCxOS4PStqG9DuEjAr2ZjZQtvS3d4y9r0cvRhvS17SGN/a_7a4vuubc6mo8.m3u8
```

**Fallback (MP3):**
```
https://stream.zeno.fm/tv0x28xvyc9uv
```

## Install

```bash
npm install -g @webos-tools/cli
ares-package /path/to/app -o .
ares-install -d <device> com.quran.radio.cairo_1.0.0_all.ipk
ares-launch -d <device> com.quran.radio.cairo
```
