import { Link } from "react-router";
import { ContactDetails, InfoPage, InfoList, type InfoSection } from "./InfoPage";

const sections: InfoSection[] = [
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
        items={[
          "To fill and deliver your orders",
          "To contact you about your order",
          "To send you news, only if you joined our mailing list",
        ]}
      />
    ),
  },
  {
    title: "Who sees it",
    body: (
      <p>
        We share your details only as needed with the courier that delivers your order, and with the payment and email
        providers we use.
      </p>
    ),
  },
  {
    title: "Technical data",
    body: (
      <>
        <p>
          To prevent abuse, we keep a one-way hash of your connection address for about an hour. Our hosting providers
          may also log it.
        </p>
        <p>Your cart is stored in your browser and is sent to us only when you check out.</p>
      </>
    ),
  },
  {
    title: "Mailing list",
    body: (
      <p>
        If you join our mailing list we keep the name you gave (if any), your phone number or email address, the time you
        agreed and the wording you agreed to. You can{" "}
        <Link to="/unsubscribe" className="underline underline-offset-2 hover:text-b60">
          unsubscribe
        </Link>{" "}
        at any time. We then stop sending you news and keep a note that you opted out.
      </p>
    ),
  },
  {
    title: "Questions about your information",
    body: (
      <>
        <p>Contact us to see, correct or delete the information we hold about you.</p>
        <ContactDetails />
      </>
    ),
  },
];

export function Privacy() {
  return (
    <InfoPage
      eyebrow="Help"
      title="Privacy"
      intro="What we collect when you shop with us, why, and how to ask about it."
      sections={sections}
    />
  );
}
