// Compiles a client's structured configuration into a Retell LLM general_prompt.
// Clients never touch the raw prompt; they edit these fields and we template them.

export const STRUCTURED_FIELDS = [
  "businessName",
  "industry",
  "agentRole",
  "tone",
  "greeting",
  "services",
  "hours",
  "location",
  "escalation",
  "faqs",
];

export const emptyStructuredConfig = () => ({
  businessName: "",
  industry: "",
  agentRole: "receptionist",
  tone: "friendly and professional",
  greeting: "",
  services: "",
  hours: "",
  location: "",
  escalation: "",
  faqs: [],
});

const section = (title, body) => (body ? `## ${title}\n${body}\n` : "");

const formatFaqs = (faqs) => {
  if (!Array.isArray(faqs) || faqs.length === 0) {
    return "";
  }
  return faqs
    .filter((faq) => faq && (faq.question || faq.answer))
    .map(
      (faq, i) =>
        `${i + 1}. Q: ${faq.question || ""}\n   A: ${faq.answer || ""}`
    )
    .join("\n");
};

export const compilePrompt = (config = {}) => {
  const c = { ...emptyStructuredConfig(), ...(config || {}) };
  const name = c.businessName || "the business";
  const role = c.agentRole || "receptionist";

  const intro =
    `You are the AI ${role} for ${name}` +
    (c.industry ? `, a ${c.industry} business` : "") +
    `. Speak in a ${c.tone || "friendly and professional"} tone. ` +
    `Keep responses concise and natural for a phone conversation. ` +
    `If you don't know an answer, say so honestly and offer to take a message or connect the caller.\n`;

  return [
    intro,
    section("Greeting", c.greeting && `Open the call with: "${c.greeting}"`),
    section("Services", c.services),
    section("Hours", c.hours),
    section("Location", c.location),
    section("When to escalate or transfer", c.escalation),
    section("Frequently asked questions", formatFaqs(c.faqs)),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
};
