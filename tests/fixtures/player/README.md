These three HLS segments contain 30 seconds of an FFmpeg-generated moving test
pattern and a quiet 440 Hz tone. They use H.264 Baseline video, AAC audio, and
independent segments with a keyframe every two seconds.

The previous shortened Big Buck Bunny fixture triggered a decoding error when
Linux Playwright WebKit sought to 26 seconds. This synthetic clip keeps real HLS
playback and seeking coverage without that decoder incompatibility or external
media dependencies. It also makes the fixture smaller and reproducible.

Used only by Playwright route interception. They are not shipped in `public/`
or used by the application. Playback tests need no external stream or Jellyfin
server and do not touch real watch history or media files.

To regenerate from the repository root (FFmpeg 6.1.1 with libx264 was used):

```sh
fixture_tmp=$(mktemp -d)
ffmpeg -hide_banner -loglevel warning \
  -f lavfi -i testsrc2=size=320x180:rate=24 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 30 -c:v libx264 -profile:v baseline -pix_fmt yuv420p \
  -preset fast -crf 28 -g 48 -keyint_min 48 -sc_threshold 0 \
  -c:a aac -b:a 64k -ac 2 -af volume=0.05 \
  -hls_time 10 -hls_playlist_type vod -hls_flags independent_segments \
  -hls_segment_filename "$fixture_tmp/segment-%d.ts" "$fixture_tmp/playlist.m3u8"
cp "$fixture_tmp/playlist.m3u8" tests/fixtures/player/playlist.m3u8
for i in 0 1 2; do
  cp "$fixture_tmp/segment-$i.ts" "tests/fixtures/player/segment-$i.mpegts"
done
```

The route fixture maps the playlist's `.ts` URLs to the checked-in `.mpegts`
files. FFmpeg is only needed to regenerate them, not to run the tests.
