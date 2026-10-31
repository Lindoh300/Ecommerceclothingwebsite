import { ContactDetails, InfoPage, InfoList, ToBeConfirmed, type InfoSection } from "./InfoPage";

const sections: InfoSection[] = [
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
      <p>
        Delivery times: <ToBeConfirmed />.
      </p>
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
