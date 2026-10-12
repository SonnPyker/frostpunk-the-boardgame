# Vietnamese localisation style sheet (shared by every translation and UI agent)

Target: Vietnamese UI text for the Frostpunk board-game web port. Source strings stay English in the code. The app
looks each one up in `apps/web/src/i18n/vi.json`, keyed by a normalised template.

## 1. Template rules (must hold exactly)

- Numbers become `{0}`, `{1}`, ... in the order they appear. Keep the same placeholder names in the Vietnamese.
  You may reorder them, but each placeholder appears exactly as often as in the key.
- `{P}` stands for a player name. Keep `{P}` in the Vietnamese, in the same number of places.
- Keep symbols as they are: `+`, `−` (U+2212), `×`, `…`, `/`, `(`, `)`, `:`, `.`, and the quoted or card ids (C01, D016, M001, S05, X01, L03, T12...).
- Keep the form of the English key. A key with a placeholder stays a template. Do not translate placeholders to words.
- Do not add or drop the final period or colon unless Vietnamese grammar needs it.

## 2. Glossary terms: keep the English term, the app annotates it

These game terms stay in English exactly as written (same capitalisation). The app shows a Vietnamese tooltip for each one
(see `scratch/i18n/glossary.json`). Never translate them, never add a Vietnamese gloss in brackets, never change case.

Hope, Discontent, Care, Justice, Motivation, Anger, Apathy, Greed, Steam Core, Generator, Meeple, Steam Hub, Workshop,
Gathering Post, Expedition, Law, Future Law, Law Consequence, Social Dispute, Advisor, Society, Automaton, Scout,
Dreadnought, Crater, Frozen Grove, Survivalist, Storm, Corpse marker, Development token, Stockpile, Heated, Insulation,
Call to Rise, Dusk

Note: "Dusk" in "Dusk deck" stays English. In the phase name "Dusk" (the phase) use "Hoàng hôn" instead.

## 3. Fixed Vietnamese for common words (use these every time)

| English | Vietnamese |
|---|---|
| Worker | Công nhân |
| Engineer | Kỹ sư |
| Child | Trẻ em |
| Citizen (card or type) | Công dân |
| Food | Thực phẩm |
| Wood | Gỗ |
| Coal | Than |
| Steel | Thép |
| Resources | Tài nguyên |
| Hunger | Đói |
| Sickness | Bệnh |
| Stress (cube) | Căng thẳng |
| Round | Vòng |
| Phase | Giai đoạn |
| Morning (phase) | Buổi sáng |
| Dawn (phase) | Bình minh |
| Dusk (phase) | Hoàng hôn |
| Night (phase) | Đêm |
| Action | Hành động |
| Pass | Bỏ lượt |
| Confirm | Xác nhận |
| Cancel | Hủy |
| Undo | Hoàn tác |
| Pay | Trả |
| Spend | Chi |
| Gain | Nhận |
| Lose | Mất |
| Remove | Gỡ bỏ |
| Discard | Bỏ |
| Draw | Rút |
| Place | Đặt |
| Build | Xây |
| Construct | Xây dựng |
| Destroy | Phá hủy |
| Dismantle | Tháo dỡ |
| Upgrade | Nâng cấp |
| Move | Di chuyển |
| Choose | Chọn |
| Option | Lựa chọn |
| Distribute | Phân bổ |
| Tile (map) | Mảnh |
| Space | Ô |
| Token | Dấu |
| Card | Thẻ |
| Event (card / display) | Sự kiện |
| Building | Công trình |
| Technology | Công nghệ |
| Law (card) | Luật |
| Scenario | Kịch bản |
| Expedition (card) | Chuyến thám hiểm, but keep "Expedition" in English where it is a glossary term (see section 2) |
| Victory | Chiến thắng |
| Defeat | Thất bại |
| Save | Lưu |
| Load / Continue | Tiếp tục |
| New game | Ván mới |
| Settings | Cài đặt |
| Rules | Luật chơi |
| Credits | Ghi công |
| Quit | Thoát |
| Player | Người chơi |
| Solo | Chơi đơn |
| Co-op | Hợp tác |
| Host / Join | Tạo phòng / Vào phòng |

Use the Vietnamese for all other words as natural game Vietnamese. Keep the tone short, like UI labels.

## 4. Style

- UI labels are short and natural: "Chọn một công trình", not "Hãy chọn một công trình để xây dựng".
- Keep the imperative tone of the English prompt: "Choose ..." becomes "Chọn ...".
- Preserve capitalisation of sentence starts. Do not add Vietnamese words the English does not imply.
- Names of buildings, citizens, laws, technologies and expeditions: translate their meaning into Vietnamese. Use the same
  Vietnamese name every time the same English name appears (check the other chunks' names through the review step).
- Never output a half-translated string. If a string is already a game-term-only label (e.g. "Hope"), keep it.

## 5. Output format

Each translation file is a JSON array with the same length and order as its chunk. Each item is `{ "key": "...", "vi": "..." }`.
Keys are copied exactly from the chunk. Write valid JSON (escape quotes; use `\n` for none; do not add comments).
