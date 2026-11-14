import { RenderAction } from "./render-action";
import { RenderQuery } from "./render-query";


export interface RenderContract {

  queries: RenderQuery;
  actions: RenderAction;
  destroy(): void;
}
