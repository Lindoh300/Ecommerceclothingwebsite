import { ContactDetails, InfoPage, InfoList, type InfoSection } from "./InfoPage";
import { shop } from "../config/shop";

const sections: InfoSection[] = [
  {
    title: "Where we deliver",
    body: <p>We deliver nationwide across South Africa.</p>,
  },
  {
    title: "Delivery options",
    body: (
      <InfoList
        items={[
          "Door delivery",
          "Locker delivery",
          "Collection",
        ]}
      />
    ),
  },
  {
    title: "Delivery fees",
    body: <p>The delivery fee for your option is shown at checkout, before you pay.</p>,
  },
  {
    title: "Delivery times",
    body: (
      <p>Door and locker delivery usually takes {shop.deliveryTime}.</p>
    ),
  },
  {
    title: "Questions",
    body: (
      <>
        <p>Contact us about your delivery:</p>
        <ContactDetails />
      </>
    ),
  },
];

export function Delivery() {
  return (
    <InfoPage
      eyebrow="Help"
      title="Delivery"
      intro="How your order reaches you, and what delivery costs."
      sections={sections}
    />
  );
}
