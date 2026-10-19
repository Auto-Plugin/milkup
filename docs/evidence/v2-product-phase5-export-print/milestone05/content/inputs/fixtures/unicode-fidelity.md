# P5 Unicode 原码位验收

原文不做 NFC/NFKC 归一化；外观相同的字符必须保留各自码位。

ALIAS_TEXT: 文一人口

ALIAS_RADICAL: ⽂⼀⼈⼝

QUOTES: `const message = '中文代码';`

COMBINING: é é Å Å

LIGATURE: office ffi fi ﬃ ﬁ

EMOJI: 😀 👩🏽‍💻 ❤️

ARABIC: العربية لا

HEBREW: שלום

SVG:

```mermaid
flowchart LR
  A[中文输入] --> B[冻结内容] --> C[打印]
```

UNICODE-END-MARKER
