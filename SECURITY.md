# Security Policy

**English** · [Русский](#политика-безопасности)

## Supported versions

Fixes are published for the **latest release** only.

## Reporting a vulnerability

**Do not open a public issue.** Use a [private security advisory](https://github.com/N0deZ3r0/fingerprint-shield/security/advisories/new) — only the
maintainer can read it.

Please include the extension version, your Chrome version and OS, the page or origin where
it happens, and what a site could learn that it should not.

First reply within **48 hours**, a decision within a week. Accepted reports are credited in
the release notes unless you would rather not be.

## Scope

This extension exists to control what a site can read about the machine. In scope:

- A host value reaching a site through a path the suites do not cover
- An incoherence a site can use — two answers to the same question that a real browser
  could not give
- The extension identifying itself to a page that did not already know
- Anything that weakens a site's own security beyond what the CSP-rewrite switch documents

**Out of scope: the sixteen items in the README's Limits section.** Those are known,
argued and deliberate. A measurement showing one of them is materially worse than described
*is* in scope — send it.

---

# Политика безопасности

**Русский** · [English](#security-policy)

## Поддерживаемые версии

Исправления выходят только для **последнего релиза**.

## Как сообщить об уязвимости

**Не создавайте публичную задачу.** Используйте
[приватный security advisory](https://github.com/N0deZ3r0/fingerprint-shield/security/advisories/new) — его видит только сопровождающий.

Приложите версию расширения, версию Chrome и ОС, страницу или origin, где это происходит,
и что именно сайт может узнать сверх положенного.

Первый ответ — в течение **48 часов**, решение — в течение недели.

## Что в области действия

Хозяйское значение, дошедшее до сайта путём, который не покрыт сьютами; несогласованность,
которой сайт может воспользоваться; самораскрытие расширения странице; ослабление защиты
сайта сверх задокументированного переключателем перезаписи CSP.

**Вне области — шестнадцать пунктов раздела «Пределы» в README.** Они известны, обоснованы
и оставлены намеренно. Но измерение, показывающее, что какой-то из них существенно хуже
описанного, — в области действия, присылайте.
