import React, { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ state: null, listeners: new Set(), api: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), push: vi.fn(), replace: vi.fn(), pathname: "/projects", staleSetter: null }));
vi.mock("../../lib/auth", () => ({
  authSession: {
    getSnapshot: () => bridge.state,
    subscribe: fn => { bridge.listeners.add(fn); return () => bridge.listeners.delete(fn); },
    initialize: async () => bridge.state.user,
    refresh: async () => bridge.state.user,
  }, loginWithGoogle: vi.fn(),
}));
vi.mock("../../lib/api", () => ({ apiFetch: (...args) => bridge.api(...args) }));
vi.mock("../../lib/projects", () => ({ listProjects: (...args) => bridge.list(...args), getProject: (...args) => bridge.get(...args), createProject: (...args) => bridge.create(...args), updateProject: (...args) => bridge.update(...args), softDeleteProject: (...args) => bridge.remove(...args) }));
vi.mock("next/link", () => ({ default: ({children,...props}) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => bridge.pathname, useRouter: () => ({push:bridge.push,replace:bridge.replace}), useSearchParams: () => new URLSearchParams() }));
vi.mock("../../components/ThemeProvider", () => ({ useTheme: () => ({dark:false,toggleTheme:()=>{}}) }));
vi.mock("../../lib/project-domain.mjs", () => ({ PROJECT_TYPES:[{value:"general",label:"General"}], technologyLabels:()=>[] }));
vi.mock("../../components/projects/ProjectDialog", () => ({ default: ({title,children}) => <section role="dialog" aria-label={title}>{children}</section> }));
vi.mock("../../components/projects/ProjectForm", () => ({ default: function Form({project,onSubmit,busy,submitLabel}) {
  const [draft,setDraft]=useState(project?.name ?? "");
  return <form onSubmit={e=>{e.preventDefault();void onSubmit({name:draft});}}>
    <input aria-label="Project draft" value={draft} onChange={e=>setDraft(e.target.value)} />
    <button disabled={busy} type="submit">{submitLabel ?? "Save changes"}</button>
  </form>;
} }));
import SettingsPage from "../../app/settings/page";
import ProjectShell from "../../components/projects/ProjectShell";
import ProjectsPage from "../../components/projects/ProjectsPage";
import ProjectDetails from "../../components/projects/ProjectDetails";
import VerifiedIdentityBoundary, { useIdentityLease } from "../../components/VerifiedIdentityBoundary";
import { useIntegrationSettings, clearIntegrationSettings, hydrateIntegrationSettingsFromAuthResponse } from "../../hooks/useIntegrationSettings";
import { preferenceStorageKey } from "../../lib/identity-lease.mjs";
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const project=(name="Project a")=>({id:"project",name,description:"",project_type:"general",revision:1,status:"active"});
const settings=id=>({github:{enabled:true,baseUrl:`https://${id}.example.test`,scopes:[]},gitlab:{enabled:false,scopes:[]},llm:{enabled:false}});
function setAccount(id) {
  bridge.state={status:id?"authenticated":"anonymous",identityKey:id,user:id?{user_id:id}:null,error:null,logoutStatus:"idle",operationBusy:false};
  clearIntegrationSettings();if(id)hydrateIntegrationSettingsFromAuthResponse(settings(id));
  for(const fn of bridge.listeners)fn();
}
function mount(child) {return render(<StrictMode>{child}</StrictMode>);}
async function integrations() {
  fireEvent.click(screen.getByRole("tab",{name:"Integration Settings"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Save integration settings"}).disabled).toBe(false));
}
let errors;
beforeEach(()=>{
  bridge.listeners.clear();bridge.pathname="/projects";
  for(const key of ["api","list","get","create","update","remove","push","replace"])bridge[key].mockReset();
  window.localStorage.clear();setAccount("a");
  bridge.api.mockImplementation(async()=>({user:{user_id:bridge.state.identityKey},settings:settings(bridge.state.identityKey)}));
  bridge.list.mockImplementation(async()=>[project(`Project ${bridge.state.identityKey}`)]);
  bridge.get.mockImplementation(async()=>project(`Project ${bridge.state.identityKey}`));
  bridge.create.mockResolvedValue(project());bridge.update.mockResolvedValue(project());bridge.remove.mockResolvedValue({id:"project",status:"deleted"});
  errors=[];vi.spyOn(console,"error").mockImplementation((...args)=>errors.push(args.map(String).join(" ")));
});
afterEach(async()=>{await act(async()=>cleanup());expect(bridge.listeners.size).toBe(0);expect(errors).toEqual([]);});
it("settings drafts and credential inputs reset on verified account replacement",async()=>{
  mount(<SettingsPage/>);await integrations();
  fireEvent.change(screen.getByLabelText("OAuth client secret"),{target:{value:"SYNTHETIC-OLD-DRAFT"}});
  act(()=>setAccount("b"));await integrations();
  expect(screen.getByLabelText("OAuth client secret").value).toBe("");
  expect(screen.getByLabelText("GitHub base URL").value).toBe("https://b.example.test");
});
it("late settings load cannot overwrite B form or global integration flags",async()=>{
  const pending=defer();bridge.api.mockImplementation((path)=>bridge.state.identityKey==="a"?pending.promise:Promise.resolve({user:{user_id:"b"},settings:settings("b")}));
  mount(<SettingsPage/>);act(()=>setAccount("b"));await integrations();
  await act(async()=>{pending.resolve({user:{user_id:"a"},settings:{...settings("a"),github:{enabled:false}}});await pending.promise;});
  expect(screen.getByLabelText("GitHub base URL").value).toBe("https://b.example.test");
  expect(screen.getByRole("checkbox",{name:/^Enable GitHub integration/}).checked).toBe(true);
});
it("late settings save cannot mark B saved or overwrite its flags",async()=>{
  const pending=defer();mount(<SettingsPage/>);await integrations();
  bridge.api.mockImplementation((path)=>path==="/v1/settings/update"?pending.promise:Promise.resolve({user:{user_id:"b"},settings:settings("b")}));
  fireEvent.click(screen.getByRole("button",{name:"Save integration settings"}));
  const saving=bridge.api.mock.calls.find(([p])=>p==="/v1/settings/update");act(()=>setAccount("b"));await integrations();
  expect(saving[1].signal.aborted).toBe(true);
  await act(async()=>{pending.resolve({settings:{...settings("a"),github:{enabled:false}}});await pending.promise;});
  expect(screen.queryByText("Integration settings saved successfully.")).toBeNull();
  expect(screen.getByRole("checkbox",{name:/^Enable GitHub integration/}).checked).toBe(true);
});
it("wrong-account settings response is rejected before hydration",async()=>{
  bridge.api.mockResolvedValue({user:{user_id:"foreign"},settings:settings("foreign")});mount(<SettingsPage/>);
  fireEvent.click(screen.getByRole("tab",{name:"Integration Settings"}));
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("different account"));
  expect(screen.getByLabelText("GitHub base URL").value).not.toContain("foreign");
});
it("account preferences do not import global or other-account values",async()=>{
  window.localStorage.setItem("coding-agent-settings",JSON.stringify({compactMode:true}));
  window.localStorage.setItem(preferenceStorageKey("a"),JSON.stringify({compactMode:true}));
  mount(<SettingsPage/>);
  await waitFor(()=>expect(screen.getByRole("checkbox",{name:/^Compact chat layout/}).checked).toBe(true));
  act(()=>setAccount("b"));
  await waitFor(()=>expect(screen.getByRole("checkbox",{name:/^Compact chat layout/}).checked).toBe(false));
  expect(JSON.parse(window.localStorage.getItem(preferenceStorageKey("a"))).compactMode).toBe(true);
});
it("storage denial leaves settings usable",async()=>{
  vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw Error("denied");});
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("denied");});
  mount(<SettingsPage/>);await integrations();expect(screen.getByLabelText("GitHub base URL").value).toContain("a.example.test");
});
it("logout hides project records and late index cannot restore them",async()=>{
  const pending=defer();bridge.list.mockReturnValue(pending.promise);
  mount(<ProjectShell><ProjectsPage/></ProjectShell>);act(()=>setAccount(null));
  await act(async()=>{pending.resolve([project("OLD-PRIVATE")]);await pending.promise;});
  expect(screen.queryByText("OLD-PRIVATE")).toBeNull();expect(screen.getByText("Sign in to manage projects")).toBeTruthy();
});
it("late creation cannot navigate under replacement identity",async()=>{
  const pending=defer();bridge.create.mockReturnValue(pending.promise);
  mount(<ProjectShell><ProjectsPage/></ProjectShell>);await screen.findByText("Project a");
  fireEvent.click(screen.getByRole("button",{name:"Create project"}));
  const dialog=screen.getByRole("dialog");fireEvent.submit(dialog.querySelector("form"));
  await waitFor(()=>expect(bridge.create).toHaveBeenCalledTimes(1));act(()=>setAccount("b"));await screen.findByText("Project b");
  await act(async()=>{pending.resolve(project("OLD-CREATED"));await pending.promise;});expect(bridge.push).not.toHaveBeenCalled();
});
it("late project save cannot display old success or change B draft",async()=>{
  const pending=defer();bridge.update.mockReturnValue(pending.promise);
  mount(<ProjectShell><ProjectDetails projectId="project" settings/></ProjectShell>);
  await waitFor(()=>expect(screen.getByLabelText("Project draft").value).toBe("Project a"));
  fireEvent.click(screen.getByRole("button",{name:"Save changes"}));await waitFor(()=>expect(bridge.update).toHaveBeenCalledTimes(1));
  act(()=>setAccount("b"));await waitFor(()=>expect(screen.getByLabelText("Project draft").value).toBe("Project b"));
  await act(async()=>{pending.resolve(project("OLD-SAVED"));await pending.promise;});
  expect(screen.queryByText("Project settings saved.")).toBeNull();expect(screen.getByLabelText("Project draft").value).toBe("Project b");
});
it("late project deletion cannot redirect after account replacement",async()=>{
  const pending=defer();bridge.remove.mockReturnValue(pending.promise);
  mount(<ProjectShell><ProjectDetails projectId="project" settings/></ProjectShell>);
  await screen.findByRole("button",{name:"Delete project"});fireEvent.click(screen.getByRole("button",{name:"Delete project"}));
  fireEvent.change(screen.getByLabelText(/Type the exact project name/),{target:{value:"Project a"}});
  fireEvent.click(screen.getByRole("button",{name:"Soft-delete project"}));await waitFor(()=>expect(bridge.remove).toHaveBeenCalledTimes(1));
  act(()=>setAccount("b"));await waitFor(()=>expect(screen.getByLabelText("Project draft").value).toBe("Project b"));
  await act(async()=>{pending.resolve({id:"project",status:"deleted"});await pending.promise;});expect(bridge.replace).not.toHaveBeenCalled();
});
it("old integration setter cannot mutate the replacement account",async()=>{
  function Capture(){const scope=useIdentityLease();const flags=useIntegrationSettings(scope.isCurrent);return <button onClick={()=>{bridge.staleSetter=flags.setGitHubIntegrationEnabled;}}>Capture setter</button>;}
  mount(<VerifiedIdentityBoundary><Capture/></VerifiedIdentityBoundary>);fireEvent.click(screen.getByRole("button",{name:"Capture setter"}));
  act(()=>setAccount("b"));act(()=>bridge.staleSetter(false));
  function View(){const flags=useIntegrationSettings();return <span>{String(flags.githubIntegrationEnabled)}</span>;}
  render(<View/>);expect(screen.getByText("true")).toBeTruthy();
});
it("route replacement aborts pending save and suppresses its notice",async()=>{
  const pending=defer();bridge.update.mockReturnValue(pending.promise);
  const view=mount(<ProjectShell><ProjectDetails projectId="project" settings/></ProjectShell>);
  await screen.findByRole("button",{name:"Save changes"});fireEvent.click(screen.getByRole("button",{name:"Save changes"}));
  await waitFor(()=>expect(bridge.update).toHaveBeenCalledTimes(1));const signal=bridge.update.mock.calls[0][3];
  bridge.pathname="/projects/other";
  view.rerender(<StrictMode><ProjectShell><ProjectDetails projectId="other" settings/></ProjectShell></StrictMode>);
  expect(signal.aborted).toBe(true);
  await act(async()=>{pending.resolve(project("OLD-ROUTE"));await pending.promise;});expect(screen.queryByText("Project settings saved.")).toBeNull();
});
