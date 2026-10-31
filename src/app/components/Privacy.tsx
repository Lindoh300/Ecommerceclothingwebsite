import { ContactDetails, InfoPage, InfoList, ToBeConfirmed, type InfoSection } from "./InfoPage";

const sections: InfoSection[] = [
  {
    title: "Who we are",
    body: (
      <p>
        This page explains how 4Nguru The Brand Online handles personal information, in line with the Protection of
        Personal Information Act (POPIA). Registered business name and registration number:{" "}
        <ToBeConfirmed />.
      </p>
    ),
  },
  {
    title: "What we collect",
    body: (
      <InfoList
        items={[
          "Your name",
          "Your phone number",
          "Your email address, if you give it to us",
          "Your delivery address",
          "Your order history",
        ]}
      />
    ),
  },
  {
    title: "Why we use it",
    body: (
      <InfoList
        items={["To fill and deliver your orders", "To contact you about your order"]}
      />
    ),
  },
  {
    title: "Who sees it",
    body: (
      <>
        <p>Your information is shared with:</p>
        <InfoList
          items={[
            "The courier that delivers your order",
            "The payment provider that handles payment",
            "The email provider we use to send emails",
          ]}
        />
      </>
    ),
  },
  {
    title: "Technical data",
    body: (
      <>
        <p>
          To prevent abuse, an IP-based value is held briefly as a salted hash. How long it is kept is{" "}
          <ToBeConfirmed />.
        </p>
        <p>Your cart is stored in your browser and is sent to us only when you check out.</p>
      </>
    ),
  },
  {
    title: "Marketing",
    body: (
      <>
        <p>
          We send marketing messages only with your consent. You can withdraw your consent at any time using the
          contact details below.
        </p>
        <p>
          If you join our mailing list we keep the name you gave (if any), your phone number or email address, the time
          you agreed and the wording you agreed to. To opt out, contact us using the details below. We then stop
          sending you news and keep a note that you opted out.
        </p>
      </>
    ),
  },
  {
    title: "Your rights",
    body: (
      <>
        <p>
          You can ask us for access to your personal information, ask us to correct it, or ask us to delete it.
          Contact us:
        </p>
        <ContactDetails />
      </>
    ),
  },
];

export function Privacy() {
  return (
    <InfoPage
      eyebrow="Legal"
      title="Privacy"
      intro="What we collect when you shop with us, why, and how to ask about it."
      sections={sections}
    />
  );
}
