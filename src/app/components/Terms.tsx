import { Link } from "react-router";
import { shop } from "../config/shop";
import { ContactDetails, InfoPage, ToBeConfirmed, InfoList, type InfoSection } from "./InfoPage";

const sections: InfoSection[] = [
  {
    title: "Who we are",
    body: (
      <>
        <p>{shop.name} sells clothing online and on WhatsApp.</p>
        <InfoList
          items={[
            <>Registered business name: <ToBeConfirmed /></>,
            <>Registration number: <ToBeConfirmed /></>,
            <>Physical address: <ToBeConfirmed /></>,
            <>Directors: <ToBeConfirmed /></>,
          ]}
        />
        <p>Contact us:</p>
        <ContactDetails />
      </>
    ),
  },
  {
    title: "Prices",
    body: <p>All prices are in South African Rand (R).</p>,
  },
  {
    title: "Orders",
    body: (
      <>
        <p>An order is confirmed once it has been paid.</p>
        <p>
          We hold stock for an unpaid order until the order expires: 48 hours for WhatsApp orders and 30 minutes
          for online orders. After that the stock is released.
        </p>
      </>
    ),
  },
  {
    title: "Delivery fees",
    body: (
      <p>
        Delivery fees are shown at checkout, before you pay. See our{" "}
        <Link to="/delivery" className="text-ink underline underline-offset-4 transition-colors hover:text-b60">
          delivery information
        </Link>
        .
      </p>
    ),
  },
  {
    title: "Governing law",
    body: <p>These terms are governed by the laws of South Africa.</p>,
  },
];

export function Terms() {
  return (
    <InfoPage
      eyebrow="Legal"
      title="Terms"
      intro="The terms that apply when you buy from 4Nguru The Brand Online."
      sections={sections}
    />
  );
}
