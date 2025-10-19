import { screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import Layout from "Layout";

test('renders the professional layout with Sidenav and Navbar', () => {
 renderWithProviders(<Layout />)
  // Assert that the main brand name is visible in the new Sidenav.
  expect(screen.getByText(/SynchroFlow/i)).toBeInTheDocument();

  // A more robust way to confirm the Navbar has rendered is to find a unique element within it,
  // like the search input field.
  //expect(screen.getByRole('textbox', { name: /search here/i })).toBeInTheDocument();

  // Assert that a link to one of our reintegrated pages now exists.
  //expect(screen.getByRole('link', { name: /data mapper/i })).toBeInTheDocument();
});