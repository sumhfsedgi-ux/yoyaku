import { describe, expect, it } from "vitest";
import { DEFAULT_RESERVATION_CONFIRMATION_BODY } from "@/lib/email/reservationEmailTemplate";
import { editorTextToTemplate, templateToEditorText } from "@/lib/email/templateEditorFormat";

describe("templateToEditorText", () => {
  it("converts a single known tag to its Japanese bracket label", () => {
    expect(templateToEditorText("{{customerName}} 様")).toBe("【お客様名】 様");
  });

  it("converts every known tag", () => {
    const body =
      "{{customerName}} {{reservationDate}} {{startTime}} {{endTime}} {{reservationTime}} {{reservationDateTime}} {{salonName}}";
    expect(templateToEditorText(body)).toBe("【お客様名】 【予約日】 【開始時間】 【終了時間】 【予約時間】 【予約日時】 【サロン名】");
  });

  it("leaves an unknown tag as literal {{tag}} text", () => {
    expect(templateToEditorText("{{foo}}")).toBe("{{foo}}");
  });

  it("preserves adjacent tags with nothing between them", () => {
    expect(templateToEditorText("{{customerName}}{{salonName}}")).toBe("【お客様名】【サロン名】");
  });
});

describe("editorTextToTemplate", () => {
  it("converts a bracket label that exactly matches a known label", () => {
    expect(editorTextToTemplate("【お客様名】 様")).toBe("{{customerName}} 様");
  });

  it("does not convert an incomplete/mistyped bracket label", () => {
    expect(editorTextToTemplate("【お客様】")).toBe("【お客様】");
    expect(editorTextToTemplate("【予約日時間】")).toBe("【予約日時間】");
  });

  it("does not confuse a prefix label (予約日) with a longer one (予約日時)", () => {
    expect(editorTextToTemplate("【予約日】")).toBe("{{reservationDate}}");
    expect(editorTextToTemplate("【予約日時】")).toBe("{{reservationDateTime}}");
  });

  it("leaves ordinary Japanese prose using 【】 untouched", () => {
    expect(editorTextToTemplate("本日は【晴れ】です")).toBe("本日は【晴れ】です");
  });
});

describe("templateToEditorText / editorTextToTemplate round-trip", () => {
  const cases = [
    "{{customerName}} 様\n\nこの度はご予約ありがとうございます。",
    "{{customerName}}{{reservationDateTime}}{{salonName}}", // adjacent tags
    "田中花子様、9月22日（火）にお待ちしております🌿", // Japanese + emoji, no tags
    "Googleマップ\nhttps://maps.app.goo.gl/ZtDx6qirtUtmZJ9F8?g_st=ic", // URL, no tags
    "{{customerName}} 様\n\n■ ご予約日時\n{{reservationDateTime}}\n\n■ サロン\n{{salonName}}\n\n改行\nテスト", // newlines
    "{{foo}} と {{customerName}}", // unknown tag mixed with known
    DEFAULT_RESERVATION_CONFIRMATION_BODY,
  ];

  it.each(cases)("editorTextToTemplate(templateToEditorText(body)) === body for %#", (body) => {
    expect(editorTextToTemplate(templateToEditorText(body))).toBe(body);
  });
});
