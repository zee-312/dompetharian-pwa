# DompetHarian — Warm Tactile Editorial

**Design intent.** A calm, paper-like place to keep an honest record of everyday rupiah. The visual language pairs editorial clarity with the reassuring feel of a well-kept pocket notebook: warm neutrals, confident ink, soft depth, and small handmade details. Keep money legible first; decoration should never compete with a number or action.

## Color tokens

| Token | Value | Role |
|---|---|---|
| Warm Oatmeal Paper | `#FAF7F2` | Main canvas and quiet surfaces |
| Soft Sand Card | `#F3EDE2` | Cards, grouped inputs, secondary panels |
| Deep Espresso Ink | `#1C1917` | Primary text, icons, strong outlines |
| Muted Stone | `#6B635B` | Secondary text, labels, helper copy |
| Forest Sage | `#2E5A44` | Income, growth, completed actions, and safe offline status |
| Warm Terracotta | `#C85A32` | Expenses, destructive emphasis, and spending cues |
| Marigold Coin | `#D99B26` | Highlights, selected accents, rewards, and coin details |

Use the named tokens consistently. Income and expense must remain distinguishable by labels and signs as well as color. Avoid using the marigold token for long text; pair it with espresso ink. Keep muted stone for supporting content with sufficient size and contrast.

## Typography

- **Plus Jakarta Sans** — interface, navigation, body copy, buttons, and numeric summaries. Use medium or semibold for hierarchy rather than all-caps.
- **Fraunces** (or a compatible expressive serif) — occasional editorial titles and warm moments such as a monthly reflection. Keep it out of dense forms and small labels.
- **JetBrains Mono** — rupiah amounts, dates, account references, and compact data where aligned digits improve scanning. Use tabular numerals when available; format values naturally for Indonesian readers (for example, `Rp 125.000`).

Maintain a clear scale: display/title, section heading, body, label, and helper. Long-form copy should be comfortable and left aligned. Numbers should never be visually smaller or less prominent than their associated labels.

## Tactile surfaces and stitching

- Build depth with a broad, faint warm shadow and a subtle lower edge, not a dark floating-card shadow. A card should feel placed on paper, not raised like plastic.
- Use Soft Sand Card against Warm Oatmeal Paper for gentle grouping. Reserve stronger borders for interactive controls and selected states.
- Corner radii should feel softened and hand-held: generous on primary cards, moderate on inputs and chips. Keep geometry consistent across a view.
- Stitching is an accent, not a texture fill: a fine dashed or dotted inset line can frame a featured wallet/card surface. Use a low-contrast sand/stone tint, leave generous padding, and omit stitching from dense lists, tiny controls, and error states.
- Keep shadows and grain understated. The interface must remain crisp on low-quality screens and usable in bright daylight.

## Interaction and state tone

Use direct labels and reassuring status cues. Offline is a supported working state: show that entries are safe on this device, and reserve warnings for an actual problem. Confirm meaningful actions in plain language. Never imply a bank connection or automatic upload if the product has not completed it.

## Indonesian UX microcopy

Use warm, conversational Bahasa Indonesia. Prefer “kamu” only where it sounds natural; keep money language concrete and unjudging. State what happened and what the person can do next.

| Moment | Suggested copy |
|---|---|
| Empty transactions | **Belum ada catatan hari ini.** Mulai dari pengeluaran kecil dulu, yuk. |
| Empty month | **Bulan ini masih kosong.** Catat pemasukan atau pengeluaran pertamamu kapan saja. |
| Offline, saved locally | **Lagi offline — catatanmu tetap tersimpan di perangkat ini.** |
| Waiting to sync | **Catatan menunggu koneksi.** Nanti akan disinkronkan saat internet kembali. |
| OCR scanning | **Sedang membaca struk…** Pastikan foto cukup terang dan tulisannya terlihat jelas. |
| OCR needs review | **Cek lagi hasil bacanya, ya.** Nominal atau tanggal di struk kadang perlu dirapikan. |
| Sync conflict | **Ada dua versi catatan ini.** Pilih versi yang ingin disimpan; kami tidak akan menghapus pilihanmu tanpa konfirmasi. |
| Sync complete | **Catatanmu sudah tersinkron.** Semua versi terbaru kini tersimpan. |

Treat these as tone examples, not promises about implementation. Keep messages short enough for mobile, provide a clear next action for recoverable issues, and avoid blame or alarmist wording.

## Logo family

The mark is an abstract folded wallet forming a capital D: a paper/leather pocket, a marigold coin, and a small sage sprout signal daily money, care, and growth. Preserve the silhouette and color roles. The primary mark is suitable for brand contexts; the adaptive icon has a safe inset for Android masking; the horizontal lockup combines mark, wordmark, and the subtitle **“Catatan jujur rupiah harianmu”**. SVG files use named groups for easy Figma selection.
