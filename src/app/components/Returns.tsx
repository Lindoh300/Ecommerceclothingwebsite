import { ContactDetails, InfoPage, InfoList, ToBeConfirmed, type InfoSection } from "./InfoPage";

const sections: InfoSection[] = [
  {
    title: "Exchanges and returns",
    body: (
      <p>
        The size exchange and returns process is <ToBeConfirmed /> by the owner.
      </p>
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
