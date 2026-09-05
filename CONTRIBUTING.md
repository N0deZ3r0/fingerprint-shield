# Contributing

**English** · [Русский](#участие-в-разработке)

## The one rule

Every fix carries a measurement. Not "this looks more realistic" — a probe output, a suite
that fails without the change, or a diff against a clean browser. The reason this project
can claim anything at all is that nothing in it was accepted on the strength of an
argument, and a pull request that changes behaviour without a measurement moves it back
towards guessing.

## Before you file a bug

Read the **Limits** section of the README. Sixteen things are listed there as knowingly
open, with the reason for each. If what you found is one of them, it is not a bug — though
a measurement showing one of them is *worse* than described is very welcome.

## Running it

```bash
npm ci
npm test           # 8 Node suites, seconds, no browser
npm run test:all   # + 32 Playwright suites, six to eight minutes, needs Chromium
```

Load it in Chrome with `chrome://extensions/` → Developer mode → **Load unpacked**, pointed
at your clone.

`mw-bundle.js` is generated. Edit the modules in `mw/` and run `npm run build`; `npm test`
fails if the bundle on disk is stale, which is the most common way to break this repo.

## Pull requests

- **One change per pull request.** A PR that fixes a leak *and* renames files is hard to
  review and hard to revert.
- **Say what you measured, and on what.** GPU, OS build and Chrome version matter here more
  than in most projects.
- **Match the surrounding code.** The comment density in this repository is deliberate:
  comments record why a thing is the way it is, usually with the measurement that forced it.
- **If you cannot run the Playwright suites, say so.** They need Windows, and a reviewer
  can run them.

## Language

Issues and pull requests in **English or Russian** are equally welcome.

---

# Участие в разработке

[English](#contributing) · **Русский**

## Единственное правило

За каждой правкой стоит измерение. Не «так выглядит правдоподобнее», а вывод пробы, сьют,
который без правки падает, или дифф против чистого браузера. Проект вообще может что-то
утверждать только потому, что ничего в нём не принято на основании рассуждения, — и
пул-реквест, меняющий поведение без измерения, возвращает его к догадкам.

## Прежде чем заводить баг

Прочитайте раздел **«Пределы»** в README. Там шестнадцать пунктов, заведомо оставленных
открытыми, и причина по каждому. Если вы нашли один из них — это не баг. А вот измерение,
показывающее, что какой-то из них *хуже*, чем описано, очень пригодится.

## Как запустить

```bash
npm ci
npm test           # 8 узловых сьютов, секунды, без браузера
npm run test:all   # + 32 браузерных, шесть-восемь минут, нужен Chromium
```

В Chrome: `chrome://extensions/` → режим разработчика → **Загрузить распакованное
расширение**, указать свой клон.

`mw-bundle.js` генерируется. Правьте модули в `mw/` и запускайте `npm run build`; `npm test`
падает, если бандл на диске устарел, — это самый частый способ сломать репозиторий.

## Пул-реквесты

- **Одно изменение — один пул-реквест.**
- **Пишите, что и на чём измеряли.** Видеокарта, сборка ОС и версия Chrome здесь важнее,
  чем в большинстве проектов.
- **Держитесь стиля вокруг.** Плотность комментариев здесь намеренная: комментарий
  фиксирует, почему сделано именно так, обычно вместе с измерением.
- **Если не можете прогнать браузерные сьюты — так и напишите.** Им нужна Windows.

## Язык

Задачи и пул-реквесты на **русском или английском** одинаково приветствуются.
