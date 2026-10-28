// src/data/portfolio.ts
// ---------------------------------------------------------------------------
// PORTFOLIO
// Every item here appears on /work. Items with `featured: true` also appear on
// the home page (the first two featured items are used).
//
// HOW TO ADD A NEW PIECE
// 1. Drop the files in /public/portfolio/
//      video:  my-new-ad.mp4   (H.264 MP4, 9:16, under ~5 MB is ideal)
//      poster: my-new-ad.webp  (a still frame, same size as the video)
//    Make a poster from any frame with:
//      ffmpeg -ss 1 -i my-new-ad.mp4 -frames:v 1 -quality 82 my-new-ad.webp
// 2. Copy the template below, paste it into the `portfolio` list, and fill it in.
//
//   {
//     slug: 'my-new-ad',                     // unique, lowercase, used as the #anchor on /work
//     title: 'My new ad',
//     style: 'UGC',                          // 'Cinematic' | 'UGC' | 'Product' | 'Image'
//     summary: 'One sentence on what the ad is.',
//     media: {
//       kind: 'video',
//       src: '/portfolio/my-new-ad.mp4',
//       poster: '/portfolio/my-new-ad.webp',
//       width: 608,                          // pixel size of the video file
//       height: 1080,
//       seconds: 10,                         // length, used for the timeline ticks
//       hookSeconds: 3,                      // optional, length of the "Hook" mark
//     },
//     bullets: [
//       'Why a choice was made.',
//       'Another choice and its reason.',
//     ],
//     note: '',                              // optional small print (trademarks, credits)
//     published: '2026-10-23',               // YYYY-MM-DD, used by search engines
//     featured: false,
//   },
//
// IMAGE ADS use this media block instead:
//     media: { kind: 'image', src: '/portfolio/my-image.webp', width: 1080, height: 1350 },
// ---------------------------------------------------------------------------

export type PortfolioStyle = 'Cinematic' | 'UGC' | 'Product' | 'Image';

export type VideoMedia = {
  kind: 'video';
  src: string;
  poster: string;
  width: number;
  height: number;
  seconds: number;
  hookSeconds?: number;
};

export type ImageMedia = {
  kind: 'image';
  src: string;
  width: number;
  height: number;
};

export type PortfolioItem = {
  slug: string;
  title: string;
  style: PortfolioStyle;
  summary: string;
  media: VideoMedia | ImageMedia;
  bullets: string[];
  note?: string;
  published: string;
  featured?: boolean;
};

export const portfolio: PortfolioItem[] = [
  {
    slug: 'city-run',
    title: 'City run',
    style: 'Cinematic',
    summary: 'A premium sportswear spot that sells the feeling of the run, not a list of features.',
    media: {
      kind: 'video',
      src: '/portfolio/cinematic-city-run.mp4',
      poster: '/portfolio/cinematic-city-run.webp',
      width: 608,
      height: 1080,
      seconds: 10,
      hookSeconds: 3,
    },
    bullets: [
      'Opens on the shoe in motion, so the product is on screen from the first frame.',
      'Golden-hour light and low tracking shots signal a premium brand without saying it.',
      'Cuts between wide strides and a close portrait to hold attention for the full ten seconds.',
      'Closes on a clean brand card that doubles as the call to action.',
    ],
    note: '',
    published: '2026-10-23',
    featured: true,
  },
  {
    slug: 'face-roller',
    title: 'Face roller',
    style: 'UGC',
    summary: 'A creator-style product demo with a natural, handheld feel.',
    media: {
      kind: 'video',
      src: '/portfolio/ugc-face-roller.mp4',
      poster: '/portfolio/ugc-face-roller.webp',
      width: 608,
      height: 1080,
      seconds: 10,
      hookSeconds: 3,
    },
    bullets: [
      'Front-camera framing in a bathroom, the place this product actually gets used.',
      'The roller is in hand from the first second and on the skin a few seconds later.',
      'Natural skin texture is kept on purpose for an everyday, unpolished look.',
      'Ends on a simple product card with one clear next step.',
    ],
    note: '',
    published: '2026-10-23',
    featured: true,
  },
  {
    slug: 'dell-technologies',
    title: 'Dell Technologies',
    style: 'UGC',
    summary: 'A singing UGC creative, a twist into entertainment.',
    media: {
      kind: 'video',
      src: '/portfolio/dell-ad-demo-v1.mp4',
      poster: '/portfolio/dell-ad-demo-v1.webp',
      width: 608,
      height: 1080,
      seconds: 9,
      hookSeconds: 3,
    },
    bullets: [
      'Sneak peek into a server room.',
      'The server engineer loves his job.',
      'Sings along with the server rack hums and beeps.',
      'Ends with a logo and motto hover.',
    ],
    note: '',
    published: '2026-10-23',
    featured: true,
  },
  {
    slug: 'amazon',
    title: 'Amazon',
    style: 'Cinematic',
    summary: 'A cinematic 16:9 spec ad, built for TV and YouTube placements.',
    media: {
      kind: 'video',
      src: '/portfolio/amazon-ad-v1.mp4',
      poster: '/portfolio/amazon-ad-v1.webp',
      width: 1280,
      height: 720,
      seconds: 9,
      hookSeconds: 2,
    },
    bullets: [
      'One product moment per scene: ordering from a phone, asking Alexa, running a smart home.',
      'Each scene shows the benefit happening instead of describing it.',
      'Landscape 16:9 framing, so it fills TV and YouTube screens.',
      'Closes on the logo, so the brand is the last thing on screen.',
    ],
    note: 'Amazon, Alexa, and their logos are trademarks of Amazon.com, Inc. or its affiliates. Spec ad shown as a visual reference only. cirfan is not affiliated with Amazon.',
    published: '2026-10-26',
    featured: false,
  },
  {
    slug: 'corsair',
    title: 'Corsair',
    style: 'Cinematic',
    summary: 'An animated 9:16 RAM advertisement.',
    media: {
      kind: 'video',
      src: '/portfolio/corsair-ad-demo-v1.mp4',
      poster: '/portfolio/corsair-ad-demo-v1.webp',
      width: 1280,
      height: 720,
      seconds: 9,
      hookSeconds: 2,
    },
    bullets: [
      'Displaying RAM sticks for visual hook to immediately show the product advertised.',
      'Stated benefits of DDR5 RAM in audio (extreme speed, vibrant RGB controls).',
      'Closes on the logo, so the brand is the last thing on screen.',
    ],
    note: 'Corsair and their logos are trademarks of Corsaier or its affiliates. Spec ad shown as a visual reference only.',
    published: '2026-10-28',
    featured: false,
  },
];

export const featured = portfolio.filter((item) => item.featured).slice(0, 2);

// Works out the shape of any video or image from its width and height.
// Used for layout (portrait, square, landscape) and for the 9 x 16 labels in the hero.
const commonRatios: [number, number][] = [
  [9, 16], [2, 3], [3, 4], [4, 5], [1, 1], [5, 4], [4, 3], [3, 2], [16, 9], [21, 9],
];

export const aspectOf = (media: { width: number; height: number }) => {
  const ratio = media.width / media.height;
  const [w, h] = commonRatios.reduce((best, r) =>
    Math.abs(r[0] / r[1] - ratio) < Math.abs(best[0] / best[1] - ratio) ? r : best,
  );
  const orientation = ratio > 1.05 ? 'landscape' : ratio < 0.95 ? 'portrait' : 'square';
  return { w, h, orientation, isVertical916: w === 9 && h === 16 } as const;
};
