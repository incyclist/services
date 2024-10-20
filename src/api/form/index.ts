
export interface Form {}

export interface IFormPostBinding {
    createForm(opts,uploadInfo):Promise<Form>
    post(opts:Form)
}