import "./styles.css";
import { createRoot } from "react-dom/client";
import { WorkbenchApp } from "./app/workbench-app.jsx";

document.addEventListener("contextmenu", (event) => event.preventDefault());

createRoot(document.getElementById("root")).render(<WorkbenchApp />);
