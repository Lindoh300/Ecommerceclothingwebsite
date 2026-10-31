import { ContactDetails, InfoPage, InfoList, ToBeConfirmed, type InfoSection } from "./InfoPage";
import { shop } from "../config/shop";

const sections: InfoSection[] = [
  {
    title: "Exchanges and returns",
    body: (
      <>
        <p>Not satisfied with your purchase? You can return or exchange items within {shop.returnDays} days of delivery.</p>
        <InfoList
          items={[
            "Items must be unworn and in original packaging",
            "Return shipping costs are the responsibility of the customer unless the item is faulty",
            "Exchanges are subject to stock availability",
          ]}
        />
        <p>These conditions do not limit any rights you have under South African law.</p>
      </>
    ),
  },
  {
    title: "How to start a return",
    body: (
      <>
        <p>Contact the shop using the details below. The full steps are <ToBeConfirmed />.</p>
        <ContactDetails />
      </>
    ),
  },
];

export function Returns() {
  return (
    <InfoPage
      eyebrow="Help"
      title="Returns"
      intro="How to exchange or return an item."
      sections={sections}
    />
  );
}
