<p align="center">
  <img src="assets/logo.png" alt="Scoreon logo" width="180" />
</p>

# Scoreon

Scoreon is a Chrome extension that helps you capture visible sheet-music or tablature frames from educational videos and export them into clean PDF or OMR-ready image packages for personal study.

I built this as a practical study tool: select the part of the video where the score appears, let the scanner collect the useful frames, clean up the result, and export it in a format that is easy to read or pass to an OMR workflow later.

## What it does

- Opens a scanner in a new tab.
- Uses the browser's normal screen/tab/window capture flow.
- Lets you draw a crop area over the score or tablature.
- Samples frames at a configurable interval.
- Filters out frames that do not look like sheet music or tablature.
- Removes near-duplicates using a simple visual signature.
- Auto-trims large white space and common black bars.
- Lets you add optional labels per captured snippet, such as `Intro`, `Verse`, or `Chorus`.
- Exports a clean PDF.
- Exports a PNG ZIP.
- Exports an OMR Package with clean PNG files, black/white OMR-ready PNG files, a preview PDF, and metadata.

## What it does not do

- It does not download videos.
- It does not bypass DRM or platform restrictions.
- It does not convert images directly to MusicXML inside the extension.
- It does not know whether a score is copyrighted. Use it only with material you own, have permission to use, or are legally allowed to process.
- The score detector is a visual heuristic, not a full AI model. It can miss frames or keep the wrong ones depending on the video.

## Install as an unpacked Chrome extension

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the `scoreon` project folder.

## Languages

Scoreon currently supports English, Greek, and Spanish through Chrome's built-in extension localization system (`_locales` + `chrome.i18n`).

Spanish support is currently AI-generated.

## Basic workflow

1. Open the video you want to study.
2. Click the Scoreon extension button.
3. Click `Open scanner`.
4. In the scanner, click `Start capture`.
5. Choose the tab or window that contains the video.
6. Drag over the area where the score or tablature appears.
7. Click `Start scan`.
8. Let the video play.
9. Click `Stop`.
10. Delete any bad captures and add optional labels.
11. Export as PDF, PNG ZIP, or OMR Package.

## Export options

### PDF

Good for reading, printing, or keeping a quick study sheet. The default orientation is **A4 portrait**.

### PNG ZIP

Exports each saved snippet as a separate PNG file. This is useful if you want to edit the images manually or use them somewhere else.

### OMR Package

Exports a ZIP like this:

```text
Song Title/
|-- original/
|   |-- 001-original.png
|   `-- 002-verse-original.png
|-- omr/
|   |-- 001-omr.png
|   `-- 002-verse-omr.png
|-- preview.pdf
|-- project.json
`-- README.txt
```

The `omr/` folder is meant for tools like Audiveris or homr. The usual workflow is:

```text
Scoreon -> OMR Package -> Audiveris/homr -> MusicXML/MXL -> MuseScore Studio
```

The OMR result will still need checking. Screenshots from videos are not the same thing as a clean scan.

## Recommended starting settings

- Frame interval: `500 ms`
- Change threshold: `12`
- Duplicate threshold: `5`
- Minimum time between saves: `900 ms`
- PDF orientation: `A4 portrait`
- PDF mode: `Compact`
- Score detector: `enabled`
- Minimum score-like confidence: `48`
- Auto-trim: `enabled`
- Padding: `18 px`

If it keeps random frames, increase the minimum score-like confidence to `55-65`.
If it misses valid score frames, lower it to `35-45`.
If it keeps too many duplicates, increase the duplicate threshold or the minimum time between saves.

## Notes for public use

Scoreon is designed as a local capture/export helper for personal study. It does not upload your captures anywhere and it does not download source videos.

Please use it responsibly with material you are allowed to process.

## Version

`1.0.0`
