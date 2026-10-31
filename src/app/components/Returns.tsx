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
        <p>These conditions do not affect your rights below.</p>
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
  {
    title: "Your rights in South Africa",
    body: (
      <>
        <p>This is general information, not legal advice.</p>
        <InfoList
          items={[
            "Online purchases: under the Electronic Communications and Transactions Act you have a cooling-off period of 7 days after delivery. The Act sets out some exceptions.",
            "Defective goods: under the Consumer Protection Act you have a right to return defective goods within 6 months.",
          ]}
        />
      </>
    ),
  },
];

export function Returns() {
  return (
    <InfoPage
      eyebrow="Help"
      title="Returns"
      intro="How to exchange or return an item, and the rights you have as a customer."
      sections={sections}
    />
  );
}
