import { mount } from "svelte";
import App from "./App.svelte";
// oxlint-disable-next-line no-unassigned-import -- global stylesheet
import "./style.css";

mount(App, { target: document.getElementById("app")! });
