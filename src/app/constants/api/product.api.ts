import { environment } from "src/environments/environment"

export const baseUrl = environment.baseUrl

export const auth = {
  createAcc : "api/v1/logincontroller/create",
  loginAcc:"api/v1/logincontroller/auth",
  updateEak: "api/v1/logincontroller/updateEak",
  forgotPassword:"api/v1/logincontroller/sendresetpasswordlink",
  resetPasswordUrl: 'api/v1/logincontroller/resetpasswordupdate'
}



export const notes = {
  controller: 'api/v1/notescontroller/',
  upload: 'upload',
  syncPlan: 'sync-plan',
};

export function buildApiUrl(path: string): string {
  return `${baseUrl}${path}`;
}
