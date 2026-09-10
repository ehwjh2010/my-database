import "./styles.css";
import { createRoot } from "react-dom/client";
import { WorkbenchApp } from "./app/workbench-app.jsx";
import { suppressNativeContextMenu } from "./lib/suppress-native-menu.js";

suppressNativeContextMenu();

createRoot(document.getElementById("root")).render(<WorkbenchApp />);
