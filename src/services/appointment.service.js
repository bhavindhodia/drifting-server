const httpStatus = require('http-status')
const { Appointment, Payment,ZoomData } = require('../models')
const User = require('../models/user.model')
const axios = require('axios');
const ApiError =require('../utils/ApiError');
const zoomHeaders={
      "User-Agent": "Zoom-api-Jwt-Request",
      "content-type": "application/json",
    } 
const createAppointment = async(appointmentData,user,zoomMeetID,paymentID,next) =>{
    return new Promise(async(resolve,reject)=>{
console.log("Creating Appointment")
        const saveData ={
            teacherID:user._id,
            meetID:zoomMeetID,
            ...appointmentData
        }
        console.log("saveData",saveData)
        try {
            const newAppointment = await Appointment.create(saveData)
            
             return resolve(newAppointment)
        } catch (err) {
             if(err) return reject({statusCode:httpStatus.CONFLICT,message:err.message})
        }

    })
}
const patchAppointment = async(appointmentID,updateData) =>{
    return new Promise(async(resolve,reject)=>{
        try {
         
            const appointmentData = await Appointment.findByIdAndUpdate({_id:appointmentID},updateData,{new:true})
            //console.log("appointmentData",appointmentData);
             return resolve({success:true,appointmentData})
        } catch (err) {
             if(err) return reject({statusCode:httpStatus.CONFLICT,errorMessage:err.message})
        }

    })
}

const getDates=(viewName,currentDate)=>{
    var curr = new Date(currentDate);
    console.log("currentDate",currentDate)
    console.log("curr",curr.getUTCDate() )
    var firstday;
    var lastday;
    var x;
    var y;
    
    switch (viewName) {
        case 'Week':
              var first = curr.getUTCDate() - curr.getUTCDay(); 
                var last = first + 6; 
                x = new Date(curr.setDate(first));
                y = new Date(curr.setDate(last));
                
            break;
        case 'Month':
                x=  new Date(curr.getUTCFullYear(), curr.getUTCMonth(), 1);
               y = new Date(curr.getUTCFullYear(), curr.getUTCMonth() + 1, 0);
             
            break;
    
        default:
            x=new Date()
            y=new Date()
            break;
    }
    firstday=new Date(x.setHours(0,0,0,0))
    lastday=new Date(y.setHours(23,59,59,999))
  
    return {firstday,lastday}
}
const getAppointment = async(viewName="Week",currentDate=new Date(),userID,userRole="STUDENT" )=>{
    return new Promise(async(resolve,reject)=>{
        try {
            const {firstday,lastday}=getDates(viewName,currentDate)
           /*  console.log("fistDate",firstday.toLocaleString())
            console.log("lastday",lastday.toLocaleString()) */
            const appointmentData = await Appointment.find({startDate:{$gte:firstday},endDate:{$lte:lastday}}).populate("studentID",'name').populate('teacherID','name').populate('meetID',['join_url','start_url']).lean()
            if(userRole==="TEACHER"){
                appointmentData.map((item)=>{
                item['id']=item['_id']
                item['readOnly']= userID.equals(item.teacherID._id)?false:true
                delete item['_id']
                return item
            })}
            else if(userRole=="STUDENT"){
                appointmentData.map(item=>{
                    console.log('item.studentID.length',item.studentID.length)
                    console.log('item.meetLimit',item.meetLimit)
                  item['readOnly']= item.studentID.length>= item.meetLimit ? true :false  
                return item
                })
            }
           // console.log("appointmentData service ",appointmentData);
            return resolve({success:true,appointmentData:appointmentData})
        } catch (err) {
             if(err) return reject({statusCode:httpStatus.CONFLICT,message:err.message})
        }

    })
}

const getListByRole = async(role) =>{
    return new Promise(async(resolve,reject)=>{
        try {
            const list = await User.find({role}).select(['name','email','username'])

            return resolve({success:true,[role.toLowerCase().concat('List')]:list})
        } catch (err) {
             if(err) return reject({statusCode:httpStatus.CONFLICT,message:err.message})
        }

    })
}


const createMeet = async(zoomToken,meetMetaData) =>{
      return new Promise(async(resolve,reject)=>{
        try {
           
    const createMeetUrl= "https://api.zoom.us/v2/users/me/meetings"
    const body={
      topic: meetMetaData.title,
      type: 1,
      settings: {
        host_video: "true",
        participant_video: "true",
      },
    }
      
            const response = await axios.post(createMeetUrl,body,{headers:{Authorization:`Bearer ${zoomToken}`,...zoomHeaders}})
            try {
                const zoomData =await ZoomData.create(response.data)
                return resolve(zoomData)
            } catch (error) {
                if(error) return reject({statusCode:httpStatus.CONFLICT,message:error.message})
            }
             
        } catch (err) {
             if(err) return reject({statusCode:httpStatus.CONFLICT,message:err.message})
        }

    })
  
}

const zoomDelete=async(appointmentData,zoomToken,nonRefundedStudent=[])=>{
     const deleteMeetUrl = `https://api.zoom.us/v2/meetings/${appointmentData.meetID.id}`
      try{
            const meetResponse = await axios.delete(deleteMeetUrl,{headers:{Authorization:`Bearer ${zoomToken}`,...zoomHeaders}})
            console.log("meetResponse",meetResponse)
            if(meetResponse.status===204){
                    console.log("MeetDeleted Successfully")
                    const zoomData = await ZoomData.findByIdAndDelete(appointmentData.meetID._id)
                    console.log("Meet Removed from DB Successfully")
                    const appointmentResponse = await Appointment.findByIdAndDelete(appointmentData._id)
                    console.log("Appointment Removed from DB Successfully")
                    if(nonRefundedStudent.length>0){
                               return ({success:true,zoomData,appointmentResponse,errorMessage:nonRefundedStudent.toString()})
                            }
                    return ({success:true,zoomData,appointmentResponse})
                }
                
                return({success:false,errorMessage:meetResponse})
            }
    catch(error){
        console.log("meetResponseError",error)
        return ({success:false,errorMessage:error.message})
    }
                
                
}

const deleteAppointment=async(appointmentData,zoomToken,stripe,next)=>{
     console.log('appointmentData',appointmentData)
     try{ 
         const deleteMeetUrl = `https://api.zoom.us/v2/meetings/${appointmentData.meetID.id}`
         let refundSuccessCount=0
         let nonRefundedStudent=[]

         if(appointmentData.paymentID.length<1){
           return await zoomDelete(appointmentData,zoomToken)
          
                }
                
                const refund = await Promise.allSettled(appointmentData.paymentID.map(async( payment ,key) =>{
                    try {
                       
                        const refundStatus= await stripe.refunds.create({
                            payment_intent: payment.id,
                            amount: process.env.PAYMENT_AMOUNT,
                    });
                   // console.log('refundStatus',refundStatus)
                    if(refundStatus.status==='succeeded') {
                        refundSuccessCount+=1
                        const{studentID,_id}= await Payment.findByIdAndUpdate(payment._id,{refunded:true})
                       // console.log("Payment",studentID,_id)
                        
                        const appresp = await Appointment.findByIdAndUpdate(appointmentData._id,{$pull:{"studentID":studentID,"paymentID":_id}})
                       // console.log("appresp",appresp)
                        return(refundStatus)
                    }
                    
                } catch (error) {
                    console.log("error",error)
                    nonRefundedStudent.push(`Refund failed for ${appointmentData.studentID[key].name} - ${error.message}`)            
                    throw(`Refund failed for ${appointmentData.studentID[key].name} - ${error.message}   `)
                    
                 }
                 
                }))
                /* console.log("refundSuccessCount",refundSuccessCount)
                console.log("nonRefundedStudent",nonRefundedStudent)
                console.log("REfund Map",refund.map(promise => promise)); */
                if(refundSuccessCount>0){
                     return  await zoomDelete(appointmentData,zoomToken,nonRefundedStudent)
                     
              
            }
            return({success:false,errorMessage:nonRefundedStudent.toString()})
        }
            
   catch(error){
       throw {statusCode:httpStatus.CONFLICT,message:error.message}
   }
}

const createPayment =async(paymentIntent,appointmentID,studentID)=>{
    return new Promise(async(resolve,reject)=>{
         try {
                 const paymentData = await Payment.create({appointmentID,studentID,...paymentIntent})
                return resolve(paymentData)
            } catch (error) {
                if(error) return reject({statusCode:httpStatus.CONFLICT,message:error.message})
            }
      
    })
}

module.exports = {
    createAppointment,
    getAppointment,
    getListByRole,
    createMeet,
    patchAppointment,
    createPayment,
    deleteAppointment
};
